// src/handlers/message/voiceRouter.js
// Ovozli xabarni sotuv yoki chiqimga yo'naltiradi

const { getMode, setMode, redis } = require("../../services/auth");
const { getUserName }             = require("../../logic/ui");
const { transcribeTelegramVoice } = require("../../services/stt");
const { processSaleInput }        = require("./saleMessage");
const { normalizeSaleTextWithAI } = require("../../services/aiSale");
const { isLikelySaleText }        = require("../../services/saleGuard");
const { normalizeExpenseVoiceText } = require("../../services/aiExpense");
const { REQUIRED_DESCRIPTION_CATEGORIES } = require("../expenseFlow");
const { saveExpenseWithTx }       = require("../../logic/storage");
const { expenseNotifyText }       = require("../../utils/report");
const { sendToGroup }             = require("../../services/notify");
const { formatMoney }             = require("../../utils/money");
const { parseSaleMessage }        = require("../../utils/parseSale");
const { spokenAmounts }           = require("../../utils/uzNumbers");
const { expenseCategoryTitle }    = require("./helpers");

// ── Xato matnlarini standartlashtirish ──────────────────
function voiceErrorText(err) {
    const msg = String(err?.message || "").toUpperCase();
    if (msg.includes("FFMPEG_NOT_INSTALLED"))
        return "❌ Ovoz konvertatsiyasi uchun ffmpeg o'rnatilmagan.";
    if (msg.includes("FFMPEG_FAILED"))
        return "❌ Ovoz formati noto'g'ri. OGG yoki MP3 yuboring.";
    if (msg.includes("TELEGRAM_DOWNLOAD"))
        return "❌ Ovoz faylini yuklab bo'lmadi. Qayta yuboring.";
    if (msg.includes("OPENAI_AUTH"))
        return "❌ AI sozlanmagan. Admin bilan bog'laning.";
    if (msg.includes("OPENAI_QUOTA"))
        return "⚠️ AI limiti tugagan. Matn orqali kiriting.";
    if (msg.includes("OPENAI_TEMP"))
        return "⏳ AI vaqtincha ishlamaydi. Biroz kuting.";
    return "❌ Ovoz tahlilida xatolik. Qayta yuboring yoki matn kiriting.";
}

// ── Ovoz oqimi qoidalari ─────────────────────────────────
const MAX_VOICE_SEC = Number(process.env.VOICE_MAX_SEC || 40);   // uzun gap = sotuv emas, token tejaymiz
const MIN_VOICE_SEC = 1;

// Ovoz bilan emas, qo'lda (matn) kiritiladigan rejimlar
const STRUCTURED_MODES = new Set([
    "await_password", "add_worker", "close_cash_tort", "owner_withdraw_amount", "owner_withdraw_desc"
]);

// Matnda sotuvga o'xshash narsa bormi? (AI ga bormasdan oldin — token sarflamaslik uchun)
const SPOKEN_NUMS = /(^|\s)(bir|bitta|ikki|ikkita|uch|uchta|to['‘’`]?rt(ta)?\s*(ming|yuz|ta|dona)|besh|olti|yetti|sakkiz|to['‘’`]?qqiz|o['‘’`]?n|yigirma|o['‘’`]?ttiz|qirq|ellik|oltmish|yetmish|sakson|to['‘’`]?qson|yuz)(\s|$)/i;
function looksLikeSaleSpeech(text) {
    const t = String(text || "").toLowerCase();
    if (t.length < 4) return false;
    if (/\d/.test(t)) return true;                       // "140 ming", "2 ta"
    if (/\b(ming|million|mln|so['‘’`]?m)\b/.test(t)) return true;
    return SPOKEN_NUMS.test(t);                            // "yuz qirq ming"
}

function esc(x) {
    return String(x || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// "Tort 140000, Sham 2ta 5000" — har bir qismdagi oxirgi son narx; <1000 bo'lsa shubhali
function findSuspiciousPrice(norm) {
    for (const part of String(norm).split(/[,;]/)) {
        const p = part.trim();
        if (!p || /^(berdi|tel)\b/i.test(p)) continue;
        const nums = p.replace(/\d+\s*(ta|dona|x)\b/gi, " ").match(/\d+/g);
        if (!nums) return p;                 // narxsiz qism
        const price = Number(nums[nums.length - 1]);
        if (price < 1000) return p;
    }
    return null;
}

// AI natijasini gapga qarshi tekshirish. Qaytaradi: { ok, reasons[] }
// ok=true → avtomatik saqlash xavfsiz; ok=false → sotuvchidan tasdiq so'raymiz
function verifySale(spoken, normalized) {
    const reasons = [];
    const parsed = parseSaleMessage(normalized);
    if (!parsed.items.length) return { ok: false, reasons: ["tushunilmadi"], parsed };

    const said = spokenAmounts(spoken);
    let total = 0;
    for (const it of parsed.items) {
        if (!said.has(Number(it.price))) reasons.push(`narx ${it.price} gapda yo'q`);
        if (it.qty > 30) reasons.push(`miqdor ${it.qty} katta`);
        if (it.price > 3000000) reasons.push(`narx ${it.price} juda katta`);
        total += it.price * it.qty;
    }
    if (total > 10000000) reasons.push("jami juda katta");
    if (parsed.items.length > 8) reasons.push("juda ko'p pozitsiya");
    return { ok: reasons.length === 0, reasons, parsed };
}

// ── Asosiy router ────────────────────────────────────────
async function routeVoiceMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const mode   = await getMode(userId);

    // Chiqim rejimida — chiqim; qo'lda kiritiladigan rejimlarda — ogohlantirish;
    // boshqa hamma holatda (menyu, sotuv, bo'sh) — avtomatik SOTUV (tugma bosish shart emas)
    if (mode === "expense") return handleExpenseVoice(bot, msg);

    if (STRUCTURED_MODES.has(mode)) {
        return bot.sendMessage(chatId, "⚠️ Hozir ovoz qabul qilinmaydi. Javobni matn bilan yozing.");
    }

    return handleSaleVoice(bot, msg);
}

// Ovoz davomiyligi tekshiruvi — yuklab olishdan oldin (bepul)
function voiceDurationProblem(msg) {
    const d = Number(msg.voice?.duration || 0);
    if (d && d < MIN_VOICE_SEC) return "short";
    if (d > MAX_VOICE_SEC) return "long";
    return null;
}

// ── SOTUV — ovoz ────────────────────────────────────────
async function handleSaleVoice(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const seller = { tgId: userId, tgName: getUserName(msg) };

    // 0. Davomiylik (uzun gap / bo'sh ovoz — STT ham, AI ham ishlamaydi)
    const problem = voiceDurationProblem(msg);
    if (problem === "long") {
        return bot.sendMessage(chatId,
            `⚠️ Ovoz juda uzun (>${MAX_VOICE_SEC} soniya). Faqat sotuvni ayting:\n<i>"Tort 140 ming, sham 2 ta 5 ming"</i>`,
            { parse_mode: "HTML" });
    }
    if (problem === "short") return; // tasodifiy bosish — jim

    const waitMsg = await bot.sendMessage(chatId,
        "🎤 <b>Ovoz qabul qilindi</b>\n⏳ Matniga o'girmoqda...",
        { parse_mode: "HTML" }
    ).catch(() => null);

    try {
        // 1. STT — ovoz → matn
        const spoken = await transcribeTelegramVoice(bot, msg.voice.file_id, { kind: "sale" });

        if (!spoken || spoken.length < 3) {
            await bot.editMessageText(
                "❌ Ovozdan matn olinmadi.\n\nGapirib ko'rsating:\n<i>\"Tort Shokoladniy yuz yigirma ming, Pepsi o'n yetti ming\"</i>",
                { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
            ).catch(() => bot.sendMessage(chatId, "❌ Ovozdan matn olinmadi."));
            return;
        }

        // 1b. Sotuvga o'xshamasa — AI ga umuman yubormaymiz (token tejash)
        if (!looksLikeSaleSpeech(spoken)) {
            await bot.editMessageText(
                `🙅 Bu sotuv emas — o'tkazib yuborildi.\n🎤 <i>${esc(spoken)}</i>\n\n` +
                `Faqat sotuvni ayting: <i>"Tort 140 ming, sham 2 ta 5 ming"</i>`,
                { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
            ).catch(() => {});
            return;
        }

        // 2. Matnni ko'rsatamiz
        await bot.editMessageText(
            `🎤 <b>Eshitildi:</b> <i>${esc(spoken)}</i>\n\n⚙️ AI tahlil qilmoqda...`,
            { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
        ).catch(() => {});

        // 3. AI normalizatsiya
        // AI asosiy; AI ishlamasa (limit/tarmoq/xato) — dastur o'zi (parseSale) zahira sifatida tahlil qiladi
        let normalized, usedFallback = false;
        try {
            normalized = await normalizeSaleTextWithAI(spoken);
        } catch (aiErr) {
            console.error("VOICE_SALE_AI_FALLBACK:", aiErr?.message);
            const local = parseSaleMessage(spoken);
            if (!local.items.length) throw aiErr;          // zahira ham topolmadi → odatiy xato xabari
            normalized = spoken;
            usedFallback = true;
        }

        if (!normalized) {
            await bot.sendMessage(chatId,
                `⚠️ Sotuv aniqlanmadi.\n\n🎤 Eshitildi: <i>${esc(spoken)}</i>\n\n` +
                "Aniqroq ayting:\n<i>\"Tort Napoleon yuz qirq ming, berdi uch yuz ming\"</i>",
                { parse_mode: "HTML" }
            );
            return;
        }

        // 3b. Narx sanity: 1000 so'mdan kichik narx = noto'g'ri eshitilgan
        const bad = findSuspiciousPrice(normalized);
        if (bad) {
            await bot.editMessageText(
                `⚠️ Narx aniq emas ("${esc(bad)}"). Qayta ayting.\n🎤 <i>${esc(spoken)}</i>\n→ <code>${esc(normalized)}</code>`,
                { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
            ).catch(() => {});
            return;
        }

        // 4. Natijani ko'rsatib, saqlash
        await bot.editMessageText(
            `✅ <b>Tahlil qilindi:</b>\n<code>${esc(normalized)}</code>`,
            { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
        ).catch(() => {});

        // 5. Ikkinchi himoya: narxlar gapda haqiqatan aytilganmi?
        const v = verifySale(spoken, normalized);
        if (!v.ok && usedFallback) v.reasons.unshift("AI ishlamadi, dastur tahlili");
        if (!v.ok) {
            await redis.set(`vsale:${userId}`, JSON.stringify({ text: normalized }), "EX", 300);
            const lines = v.parsed.items.map(i => `• ${esc(i.name)} ${i.qty > 1 ? i.qty + " ta × " : ""}${formatMoney(i.price)}`).join("\n");
            await bot.sendMessage(chatId,
                `🤔 <b>Ishonchim komil emas — tasdiqlang</b>\n🎤 <i>${esc(spoken)}</i>\n\n${lines || esc(normalized)}\n\n` +
                `<i>(${esc(v.reasons.join("; "))})</i>`,
                { parse_mode: "HTML", reply_markup: { inline_keyboard: [[
                    { text: "✅ Saqlash", callback_data: "vsale_ok" },
                    { text: "❌ Bekor",   callback_data: "vsale_no" }
                ]] } }
            );
            return;
        }

        return processSaleInput(bot, msg, normalized, seller, { tryAI: false });

    } catch (e) {
        console.error("VOICE_SALE_ERROR:", e?.message);
        const errText = voiceErrorText(e);
        await bot.sendMessage(chatId,
            `${errText}\n\n📝 Matn orqali kiriting:\n<i>Tort Shokoladniy 120000, Pepsi 17000</i>`,
            { parse_mode: "HTML" }
        );
    }
}

// ── CHIQIM — ovoz ────────────────────────────────────────
async function handleExpenseVoice(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    const waitMsg = await bot.sendMessage(chatId,
        "🎤 <b>Ovoz qabul qilindi</b>\n⏳ Chiqim tahlil qilinmoqda...",
        { parse_mode: "HTML" }
    ).catch(() => null);

    try {
        // 1. STT
        const spoken = await transcribeTelegramVoice(bot, msg.voice.file_id);

        if (!spoken || spoken.length < 3) {
            await bot.sendMessage(chatId,
                "❌ Ovozdan matn olinmadi.\n\nMisol:\n<i>\"Ustaga eshik tuzatish uchun yuz yigirma ming berdim\"</i>",
                { parse_mode: "HTML" }
            );
            return;
        }

        // 2. Ko'rsatamiz
        await bot.editMessageText(
            `🎤 <b>Eshitildi:</b> <i>${spoken}</i>\n\n⚙️ Chiqim aniqlanmoqda...`,
            { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
        ).catch(() => {});

        // 3. AI normalize
        const data = await normalizeExpenseVoiceText(spoken);
        const categoryKey = String(data?.categoryKey || "").trim();
        const amount      = Number(data?.amount || 0);
        const description = String(data?.description || "").trim();

        if (!categoryKey || !amount) {
            await bot.sendMessage(chatId,
                `⚠️ Chiqim aniqlanmadi.\n\n🎤 Eshitildi: <i>${spoken}</i>\n\n` +
                "Kategoriya va summani aniq ayting:\n" +
                "<i>\"Taksiga yigirma besh ming\"</i>\n" +
                "<i>\"Ustaga yuz ming eshik tuzatish\"</i>",
                { parse_mode: "HTML" }
            );
            return;
        }

        // 4. Firma uchun alohida flow
        if (categoryKey === "supplier") {
            await redis.set(
                `exp_state:${userId}`,
                JSON.stringify({ step: "await_supplier_amount_from_voice", amount }),
                "EX", 600
            );
            await bot.sendMessage(chatId,
                `🏷 <b>Firma (Ta'minot)</b> — ${formatMoney(amount)} so'm\n\nRo'yxatdan firmani tanlang:`,
                { parse_mode: "HTML" }
            );
            return;
        }

        // 5. Description kerak bo'lgan kategoriya
        if (REQUIRED_DESCRIPTION_CATEGORIES.has(categoryKey) && !description) {
            await redis.set(
                `exp_state:${userId}`,
                JSON.stringify({ step: "await_description", categoryKey, amount }),
                "EX", 600
            );
            await bot.sendMessage(chatId,
                `✏️ <b>${expenseCategoryTitle(categoryKey)}</b> — ${formatMoney(amount)} so'm\n\n` +
                "Qisqa tavsif yozing (masalan: <i>Bodiring, Usta haqi, Material</i>)",
                { parse_mode: "HTML" }
            );
            return;
        }

        // 6. Saqlash
        const spender = { tgId: userId, tgName: getUserName(msg) };
        const title   = expenseCategoryTitle(categoryKey);

        const exp = await saveExpenseWithTx({ spender, title, amount, categoryKey, description });

        const notify = expenseNotifyText({ spenderName: spender.tgName, title, amount });

        await bot.sendMessage(chatId,
            `✅ <b>Chiqim saqlandi</b>\n` +
            `🆔 ID: <code>${exp.orderNo || "—"}</code>\n` +
            `💸 Summa: <b>${formatMoney(amount)} so'm</b>\n` +
            `📂 Kategoriya: <b>${title}</b>` +
            (description ? `\n📝 <i>${description}</i>` : ""),
            { parse_mode: "HTML" }
        );

        await sendToGroup(bot, notify);
        await setMode(userId, "sale");
        return true;

    } catch (e) {
        console.error("VOICE_EXPENSE_ERROR:", e?.message);
        await bot.sendMessage(chatId,
            `${voiceErrorText(e)}\n\n💸 Matn orqali: <i>Kategoriya summa</i>`,
            { parse_mode: "HTML" }
        );
    }
}

module.exports = { routeVoiceMessage };
