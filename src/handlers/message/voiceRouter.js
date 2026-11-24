// src/handlers/message/voiceRouter.js
// Ovozli xabar → (validatsiya) → STT → AI → TEKSHIRUV → mavjud sotuv/chiqim servislari.
// Qoida: ovoz natijasi hech qachon tekshirilmasdan moliyaviy yozuvga aylanmaydi.

const { getMode, setMode, redis, claimOnce } = require("../../services/auth");
const { getUserName }             = require("../../logic/ui");
const { transcribeTelegramVoice } = require("../../services/stt");
const { processSaleInput }        = require("./saleMessage");
const { normalizeSaleTextWithAI } = require("../../services/aiSale");
const { normalizeExpenseVoiceText } = require("../../services/aiExpense");
const { VoiceError }              = require("../../services/openai");
const { getVoiceConfig }          = require("../../services/voiceConfig");
const { REQUIRED_DESCRIPTION_CATEGORIES, startSupplierPickWithAmount } = require("../expenseFlow");
const { saveExpenseWithTx }       = require("../../logic/storage");
const { expenseNotifyText }       = require("../../utils/report");
const { sendToGroup }             = require("../../services/notify");
const { formatMoney }             = require("../../utils/money");
const { expenseCategoryTitle }    = require("./helpers");
const { parseSaleMessage }        = require("../../utils/parseSale");
const { spokenAmounts }           = require("../../utils/uzNumbers");

// ── Sozlamalar ───────────────────────────────────────────
// Ovoz bilan emas, qo'lda (matn/rasm) kiritiladigan rejimlar
const STRUCTURED_MODES = new Set([
    "await_password", "add_worker", "close_cash_tort", "close_cash_photo1", "close_cash_photo2",
    "owner_withdraw_amount", "owner_withdraw_desc"
]);

// Boshqa oqim (matn kutayotgan holat) ochiq bo'lsa, ovoz tasodifan sotuv bo'lib ketmasin
const BLOCKING_STATE_KEYS = ["bal_edit", "pur_state", "await_pay_amount", "await_del", "owner_withdraw", "close_cash"];

// Chiqim ovozi: AI kategoriya kalitlari → mavjud (tugma orqali) chiqim oqimidagi kalitlar.
// Shunda ovozli chiqim hisobotlarda va filtrlarda oddiy chiqim bilan bir xil kategoriyada chiqadi.
const VOICE_TO_DB_KEY = Object.freeze({
    electricity: "electric", food: "lunch", repair: "master", bank: "bank_tax", cash: "cashbox",
});
const dbKey = (k) => VOICE_TO_DB_KEY[k] || k;

// ── Yordamchilar ─────────────────────────────────────────
function esc(x) {
    return String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Loglarda API kalit/token qoldiqlari bo'lmasin
function redactMsg(s) {
    return String(s || "").replace(/sk-[A-Za-z0-9_\-*]{6,}/g, "sk-***").replace(/bot\d{6,}:[\w-]{20,}/g, "bot***").slice(0, 200);
}

function logVoiceError(kind, e) {
    const code = e?.code || e?.message || "UNKNOWN";
    const cause = e?.cause;
    console.error(`[voice] ${kind} xato: ${code}` +
        (cause ? ` (status=${cause.status || "-"} ${redactMsg(cause.message)})` : ""));
}

// Xabarni tahrirlash; bo'lmasa — yangi xabar (Telegram edit xatolariga chidamli). Yangi message_id ni qaytaradi.
async function safeEdit(bot, chatId, messageId, text, extra = {}) {
    if (messageId) {
        try {
            await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: "HTML", ...extra });
            return messageId;
        } catch (e) {
            if (/not modified/i.test(String(e?.message || ""))) return messageId;
        }
    }
    const m = await bot.sendMessage(chatId, text, { parse_mode: "HTML", ...extra }).catch(() => null);
    return m?.message_id || messageId || null;
}

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new VoiceError("OPENAI_TEMP_UNAVAILABLE", { retryable: false })), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
});

// ── Foydalanuvchiga tushunarli xabarlar ──────────────────
function voiceErrorText(err) {
    switch (err?.code) {
        case "VOICE_TOO_SHORT":        return "⚠️ Ovoz juda qisqa. Qayta yuboring.";
        case "VOICE_TOO_LONG":         return `⚠️ Ovoz juda uzun (>${getVoiceConfig().maxSec} soniya). Qisqa va aniq ayting.`;
        case "VOICE_FILE_TOO_LARGE":   return "⚠️ Ovoz fayli juda katta. Qisqaroq yuboring.";
        case "TELEGRAM_DOWNLOAD_FAILED":
        case "TELEGRAM_FILE_UNAVAILABLE": return "❌ Ovozni yuklab bo'lmadi. Qayta yuboring.";
        case "FFMPEG_NOT_INSTALLED":   return "❌ Serverda ovoz konvertori (ffmpeg) yo'q. Administratorga xabar bering.";
        case "FFMPEG_TIMEOUT":
        case "FFMPEG_FAILED":          return "❌ Ovoz formati o'qilmadi. Qayta yuboring.";
        case "OPENAI_AUTH_FAILED":
        case "OPENAI_MODEL_UNAVAILABLE": return "❌ AI sozlanmagan. Administratorga xabar bering.";
        case "OPENAI_QUOTA_OR_LIMIT":  return "⚠️ AI limiti tugagan. Hozircha matn orqali kiriting.";
        case "OPENAI_RATE_LIMIT":      return "⏳ AI band. Biroz kutib qayta yuboring.";
        case "OPENAI_TEMP_UNAVAILABLE":return "⏳ AI vaqtincha ishlamayapti. Qayta urinib ko'ring yoki matn kiriting.";
        case "OPENAI_INVALID_AUDIO":   return "❌ Ovoz tushunarsiz. Qayta yuboring.";
        case "STT_EMPTY_RESULT":       return "❌ Ovozdan matn olinmadi. Aniqroq va balandroq ayting.";
        case "AI_INVALID_OUTPUT":
        case "AI_NORMALIZATION_FAILED":
        case "STT_FAILED":             return "⚠️ Aniq tushunmadim. Qisqa va aniq qayta ayting yoki matn kiriting.";
        default:                       return "❌ Ovoz tahlilida xatolik. Qayta yuboring yoki matn kiriting.";
    }
}

// ── Sotuvga o'xshashlik (AI ga bormasdan oldin — token tejash) ──
const SPOKEN_NUMS = /(^|\s)(bir|bitta|ikki|ikkita|uch|uchta|to['‘’`]?rt(ta)?\s*(ming|yuz|ta|dona)|besh|olti|yetti|sakkiz|to['‘’`]?qqiz|o['‘’`]?n|yigirma|o['‘’`]?ttiz|qirq|ellik|oltmish|yetmish|sakson|to['‘’`]?qson|yuz|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|двадцать|тридцать|сорок|пятьдесят|сто|тысяч)(\s|$)/i;
function looksLikeSaleSpeech(text) {
    const t = String(text || "").toLowerCase();
    if (t.length < 4) return false;
    if (/\d/.test(t)) return true;
    if (/(^|\s)(ming|million|mln|so['‘’`]?m|тыс|тысяч|тысячи|млн)(\s|$)/.test(t)) return true;
    return SPOKEN_NUMS.test(t);
}

// "Tort 140000, Sham 2ta 5000" — 1000 so'mdan kichik narx = noto'g'ri eshitilgan
function findSuspiciousPrice(norm) {
    for (const part of String(norm).split(/[,;]/)) {
        const p = part.trim();
        if (!p || /^(berdi|tel)\b/i.test(p)) continue;
        const nums = p.replace(/\d+\s*(ta|dona|x)\b/gi, " ").match(/\d+/g);
        if (!nums) return p;
        if (Number(nums[nums.length - 1]) < 1000) return p;
    }
    return null;
}

// AI natijasini asl nutqqa qarshi tekshirish. ok=true → avtomatik saqlash xavfsiz.
function verifySale(spoken, normalized) {
    const reasons = [];
    const parsed = parseSaleMessage(normalized);
    if (!parsed.items.length) return { ok: false, reasons: ["tushunilmadi"], parsed };

    const said = spokenAmounts(spoken);
    let total = 0;
    for (const it of parsed.items) {
        const price = Number(it.price), qty = Number(it.qty || 1);
        // narx yoki (jami aytilganda) narx×miqdor gapda bo'lsa — mos
        if (!said.has(price) && !said.has(price * qty)) reasons.push(`narx ${price} gapda yo'q`);
        if (qty > 30) reasons.push(`miqdor ${qty} katta`);
        if (price > 3000000) reasons.push(`narx ${price} juda katta`);
        total += price * qty;
    }
    if (total > 10000000) reasons.push("jami juda katta");
    if (parsed.items.length > 8) reasons.push("juda ko'p pozitsiya");
    if (findSuspiciousPrice(normalized)) reasons.push("shubhali narx");
    return { ok: reasons.length === 0, reasons, parsed };
}

function verifyExpense(spoken, data) {
    const reasons = [];
    if (!spokenAmounts(spoken).has(Number(data.amount))) reasons.push(`summa ${data.amount} gapda yo'q`);
    if (data.amount > 20000000) reasons.push("summa juda katta");
    return { ok: reasons.length === 0, reasons };
}

// ── Tayyorgarlik tekshiruvlari ───────────────────────────
function validateVoiceMeta(voice, cfg) {
    if (!voice || !voice.file_id) return new VoiceError("TELEGRAM_FILE_UNAVAILABLE");
    const d = Number(voice.duration || 0);
    if (!d || d < cfg.minSec) return new VoiceError("VOICE_TOO_SHORT");
    if (d > cfg.maxSec) return new VoiceError("VOICE_TOO_LONG");
    if (voice.file_size && Number(voice.file_size) > cfg.maxFileMb * 1024 * 1024) return new VoiceError("VOICE_FILE_TOO_LARGE");
    if (voice.mime_type && !/^audio\/(ogg|opus|x-opus)/i.test(String(voice.mime_type)))
        return new VoiceError("TELEGRAM_FILE_UNAVAILABLE");   // kutilgan format emas
    return null;
}

async function inspectFlows(userId) {
    for (const k of BLOCKING_STATE_KEYS) {
        if (await redis.get(`${k}:${userId}`)) return { blocked: true, expense: false };
    }
    const raw = await redis.get(`exp_state:${userId}`);
    if (!raw) return { blocked: false, expense: false };
    let st = null;
    try { st = JSON.parse(raw); } catch { /* buzilgan holat */ }
    // Faqat "kategoriya/summa" bosqichida ovoz = chiqim; qolgan bosqichlar matn kutadi
    if (st && (st.step === "pick_category" || st.step === "amount")) return { blocked: false, expense: true };
    return { blocked: true, expense: false };
}

// Foydalanuvchi bo'yicha parallel ovoz limiti (Redis/RAM qulf — instance'lar orasida ham)
async function acquireSlot(userId, cfg) {
    const ttl = Math.ceil(cfg.processTimeoutMs / 1000) + 15;
    for (let i = 0; i < cfg.userConcurrency; i++) {
        const key = `voice_busy:${userId}:${i}`;
        if (await claimOnce(key, ttl)) return key;
    }
    return null;
}

// ── Asosiy router ────────────────────────────────────────
async function routeVoiceMessage(bot, msg) {
    if (!msg?.voice) return;                       // faqat Telegram voice
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;
    const cfg = getVoiceConfig();

    const mode = await getMode(userId);
    if (STRUCTURED_MODES.has(mode)) {
        return bot.sendMessage(chatId, "⚠️ Hozir ovoz qabul qilinmaydi. Javobni matn bilan yozing.");
    }
    const flow = await inspectFlows(userId);
    if (flow.blocked) {
        return bot.sendMessage(chatId,
            "⚠️ Hozir boshqa amal tugallanmagan — javobni matn bilan yozing yoki /start bilan bekor qiling.");
    }

    // Idempotentlik: bir xil Telegram xabari ikki marta ishlanmasin (parallel instance'larda ham)
    if (!(await claimOnce(`voice_upd:${chatId}:${msg.message_id}`, 900))) {
        console.warn("[voice] VOICE_DUPLICATE_UPDATE", chatId, msg.message_id);
        return;
    }

    const bad = validateVoiceMeta(msg.voice, cfg);
    if (bad) return bot.sendMessage(chatId, voiceErrorText(bad));

    const slot = await acquireSlot(userId, cfg);
    if (!slot) return bot.sendMessage(chatId, "⏳ Oldingi ovoz hali qayta ishlanmoqda. Tugashini kuting.");

    const kind = mode === "expense" || flow.expense ? "expense" : "sale";
    try {
        return kind === "expense" ? await handleExpenseVoice(bot, msg, cfg) : await handleSaleVoice(bot, msg, cfg);
    } finally {
        await redis.del(slot).catch(() => { });
    }
}

// STT + (bir xil audio uchun qisqa kesh) — takroriy API chaqiruvlarini oldini oladi
async function speechToText(bot, msg, kind, cfg, deadline, timings) {
    const cacheKey = msg.voice.file_unique_id ? `voice_stt:${msg.voice.file_unique_id}:${kind}` : null;
    if (cacheKey) {
        const hit = await redis.get(cacheKey);
        if (hit) { timings.cache = 1; return String(hit); }
    }
    const text = await transcribeTelegramVoice(bot, msg.voice.file_id, { kind, deadline, timings });
    if (cacheKey) await redis.set(cacheKey, text, "EX", 600);
    return text;
}

function logTimings(kind, outcome, t0, timings) {
    const parts = Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(" ");
    console.log(`[voice] kind=${kind} outcome=${outcome} total=${Date.now() - t0}ms ${parts}`.trim());
}

// ── SOTUV — ovoz ────────────────────────────────────────
async function handleSaleVoice(bot, msg, cfg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const seller = { tgId: userId, tgName: getUserName(msg) };
    const t0 = Date.now(), timings = {};
    const deadline = t0 + cfg.processTimeoutMs;

    let mid = (await bot.sendMessage(chatId, "🎤 <b>Ovoz qabul qilindi</b>", { parse_mode: "HTML" }).catch(() => null))?.message_id;

    try {
        // 1. STT
        mid = await safeEdit(bot, chatId, mid, "🎤 <b>Ovoz qabul qilindi</b>\n⏳ Ovoz matnga aylantirilmoqda...");
        const analysis = await withTimeout((async () => {
            const spoken = await speechToText(bot, msg, "sale", cfg, deadline, timings);

            // 2. Sotuvga o'xshamasa — AI ga umuman yubormaymiz (token tejash)
            if (!looksLikeSaleSpeech(spoken)) return { spoken, notSale: true };

            mid = await safeEdit(bot, chatId, mid, `🎤 <b>Eshitildi:</b> <i>${esc(spoken)}</i>\n\n⚙️ Sotuv tahlil qilinmoqda...`);

            // 3. AI asosiy; AI ishlamasa — dastur (parseSale) zahira (keyin baribir to'liq tekshiruv)
            const t1 = Date.now();
            let normalized, usedFallback = false;
            try {
                normalized = await normalizeSaleTextWithAI(spoken, { deadline });
            } catch (aiErr) {
                logVoiceError("sale-ai", aiErr);
                if (!parseSaleMessage(spoken).items.length) throw aiErr;   // zahira ham ishonchli o'qiy olmadi
                normalized = spoken; usedFallback = true;
            }
            timings.ai = Date.now() - t1;
            return { spoken, normalized, usedFallback };
        })(), cfg.processTimeoutMs);

        const { spoken } = analysis;

        if (analysis.notSale) {
            await safeEdit(bot, chatId, mid,
                `🙅 Bu sotuv emas — o'tkazib yuborildi.\n🎤 <i>${esc(spoken)}</i>\n\nFaqat sotuvni ayting: <i>"Tort 140 ming, sham 2 ta 5 ming"</i>`);
            return logTimings("sale", "not_sale", t0, timings);
        }
        if (!analysis.normalized) {
            await safeEdit(bot, chatId, mid,
                `⚠️ Sotuv aniqlanmadi.\n🎤 <i>${esc(spoken)}</i>\n\nAniqroq ayting: <i>"Tort Napoleon 140 ming"</i>`);
            return logTimings("sale", "unrecognized", t0, timings);
        }

        // 4. Tekshiruv (narxlar nutqda haqiqatan aytilganmi, chegaralar)
        const t2 = Date.now();
        const { normalized, usedFallback } = analysis;
        const v = verifySale(spoken, normalized);
        if (!v.ok && usedFallback) v.reasons.unshift("AI ishlamadi, dastur tahlili");
        timings.validate = Date.now() - t2;

        if (!v.ok) {
            await redis.set(`vsale:${userId}`, JSON.stringify({ text: normalized }), "EX", 300);
            const lines = v.parsed.items.map(i => `• ${esc(i.name)} ${i.qty > 1 ? i.qty + " ta × " : ""}${formatMoney(i.price)}`).join("\n");
            await safeEdit(bot, chatId, mid,
                `🤔 <b>Ishonchim komil emas — tasdiqlang</b>\n🎤 <i>${esc(spoken)}</i>\n\n${lines || esc(normalized)}\n\n<i>(${esc(v.reasons.join("; "))})</i>`,
                { reply_markup: { inline_keyboard: [[
                    { text: "✅ Saqlash", callback_data: "vsale_ok" },
                    { text: "❌ Bekor",   callback_data: "vsale_no" }
                ]] } });
            return logTimings("sale", "confirm", t0, timings);
        }

        // 5. Saqlash — faqat mavjud sotuv servisi orqali ("saqlandi" xabarini o'sha servis beradi)
        await safeEdit(bot, chatId, mid, `✅ <b>Tahlil qilindi:</b>\n<code>${esc(normalized)}</code>`);
        const t3 = Date.now();
        await processSaleInput(bot, msg, normalized, seller, { tryAI: false });   // tryAI:false — AI ikkinchi marta chaqirilmaydi
        timings.save = Date.now() - t3;
        return logTimings("sale", "saved", t0, timings);

    } catch (e) {
        logVoiceError("sale", e);
        logTimings("sale", `error:${e?.code || "UNKNOWN"}`, t0, timings);
        const extra = e?.code === "OPENAI_QUOTA_OR_LIMIT" || e?.code === "OPENAI_TEMP_UNAVAILABLE" || e?.code === "OPENAI_AUTH_FAILED"
            ? `\n\n📝 Matn orqali:\n<i>Tort Shokoladniy 120000, Pepsi 17000</i>` : "";
        await safeEdit(bot, chatId, mid, `${voiceErrorText(e)}${extra}`);
    }
}

// ── CHIQIM — ovoz ────────────────────────────────────────
// Tasdiqlangan/ishonchli chiqimni mavjud servis orqali saqlaydi (callback'dan ham chaqiriladi)
async function finishVoiceExpense(bot, chatId, userId, spender, data) {
    const voiceKey = String(data.categoryKey);
    const amount = Number(data.amount);
    const description = String(data.description || "").trim();
    const key = dbKey(voiceKey);

    // Firma — mavjud supplier tanlash oqimi (qarzdor firmalar ro'yxati), summa saqlanadi
    if (voiceKey === "supplier") {
        await startSupplierPickWithAmount(bot, chatId, spender, amount);
        return true;
    }

    // Tavsif majburiy kategoriya — holat saqlanib, foydalanuvchidan so'raladi (mavjud "desc" qadami)
    if (REQUIRED_DESCRIPTION_CATEGORIES.has(voiceKey) && !description) {
        await redis.set(`exp_state:${userId}`,
            JSON.stringify({ step: "desc", categoryKey: key, amount, createdBy: spender }), "EX", 900);
        await bot.sendMessage(chatId,
            `✏️ <b>${esc(expenseCategoryTitle(voiceKey))}</b> — ${formatMoney(amount)} so'm\n\n` +
            "Qisqa tavsif yozing (masalan: <i>Bodiring, Usta haqi, Material</i>)", { parse_mode: "HTML" });
        return true;
    }

    const title = expenseCategoryTitle(voiceKey);
    let exp;
    try {
        exp = await saveExpenseWithTx({ spender, title, amount, categoryKey: key, description });
    } catch (e) {
        if (String(e?.message || "").startsWith("BALANCE_LOW")) {
            const bal = Number(String(e.message).split(":")[1] || 0);
            await bot.sendMessage(chatId,
                `❌ <b>Balans yetarli emas!</b>\n🏦 Joriy balans: <b>${formatMoney(bal)}</b> so'm\n💰 Kerakli: <b>${formatMoney(amount)}</b> so'm`,
                { parse_mode: "HTML" });
            return false;
        }
        throw e;
    }

    await bot.sendMessage(chatId,
        `✅ <b>Chiqim saqlandi</b>\n🆔 ID: <code>${esc(exp.orderNo || "—")}</code>\n` +
        `💸 Summa: <b>${formatMoney(amount)} so'm</b>\n📂 Kategoriya: <b>${esc(title)}</b>` +
        (description ? `\n📝 <i>${esc(description)}</i>` : ""),
        { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🗑 O'chirish (Chiqim)", callback_data: `del_exp:${exp._id}` }]] } });

    await sendToGroup(bot, expenseNotifyText({ spenderName: esc(spender.tgName), title: esc(title), amount }));
    await redis.del(`exp_state:${userId}`);
    await setMode(userId, "sale");
    return true;
}

async function handleExpenseVoice(bot, msg, cfg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const spender = { tgId: userId, tgName: getUserName(msg) };
    const t0 = Date.now(), timings = {};
    const deadline = t0 + cfg.processTimeoutMs;

    let mid = (await bot.sendMessage(chatId, "🎤 <b>Ovoz qabul qilindi</b>", { parse_mode: "HTML" }).catch(() => null))?.message_id;

    try {
        mid = await safeEdit(bot, chatId, mid, "🎤 <b>Ovoz qabul qilindi</b>\n⏳ Ovoz matnga aylantirilmoqda...");
        const { spoken, data } = await withTimeout((async () => {
            const spoken = await speechToText(bot, msg, "expense", cfg, deadline, timings);
            mid = await safeEdit(bot, chatId, mid, `🎤 <b>Eshitildi:</b> <i>${esc(spoken)}</i>\n\n⚙️ Chiqim tahlil qilinmoqda...`);
            const t1 = Date.now();
            // AI ishlamasa chiqim SAQLANMAYDI (xato kodi bilan tushunarli xabar) — zahira yo'q
            const data = await normalizeExpenseVoiceText(spoken, { deadline });
            timings.ai = Date.now() - t1;
            return { spoken, data };
        })(), cfg.processTimeoutMs);

        if (!data) {
            await safeEdit(bot, chatId, mid,
                `⚠️ Chiqim aniqlanmadi.\n🎤 <i>${esc(spoken)}</i>\n\nKategoriya va summani aniq ayting:\n<i>"Taksiga yigirma besh ming"</i>\n<i>"Ustaga yuz ming eshik tuzatish"</i>`);
            return logTimings("expense", "unrecognized", t0, timings);
        }

        const t2 = Date.now();
        const v = verifyExpense(spoken, data);
        timings.validate = Date.now() - t2;

        if (!v.ok) {
            await redis.set(`vexp:${userId}`, JSON.stringify({ data }), "EX", 300);
            await safeEdit(bot, chatId, mid,
                `🤔 <b>Ishonchim komil emas — tasdiqlang</b>\n🎤 <i>${esc(spoken)}</i>\n\n` +
                `📂 ${esc(expenseCategoryTitle(data.categoryKey))}\n💸 ${formatMoney(data.amount)} so'm` +
                (data.description ? `\n📝 ${esc(data.description)}` : "") +
                `\n\n<i>(${esc(v.reasons.join("; "))})</i>`,
                { reply_markup: { inline_keyboard: [[
                    { text: "✅ Saqlash", callback_data: "vexp_ok" },
                    { text: "❌ Bekor",   callback_data: "vexp_no" }
                ]] } });
            return logTimings("expense", "confirm", t0, timings);
        }

        const t3 = Date.now();
        await safeEdit(bot, chatId, mid, `✅ <b>Tahlil qilindi:</b> ${esc(expenseCategoryTitle(data.categoryKey))} — ${formatMoney(data.amount)} so'm`);
        await finishVoiceExpense(bot, chatId, userId, spender, data);
        timings.save = Date.now() - t3;
        return logTimings("expense", "saved", t0, timings);

    } catch (e) {
        logVoiceError("expense", e);
        logTimings("expense", `error:${e?.code || "UNKNOWN"}`, t0, timings);
        await safeEdit(bot, chatId, mid, `${voiceErrorText(e)}\n\n💸 Matn orqali: kategoriya tanlab, summani yozing.`);
    }
}

// ── Tasdiqlash tugmalari (onCallback dan) ────────────────
// kind: "sale" | "expense". Bir xabardagi tugma faqat bir marta ishlaydi.
async function confirmVoicePending(bot, q, seller, kind, accept) {
    const chatId = q.message.chat.id;
    const userId = seller.tgId;
    const key = kind === "sale" ? `vsale:${userId}` : `vexp:${userId}`;

    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id }); } catch { }
    if (!(await claimOnce(`vconfirm:${chatId}:${q.message.message_id}`, 3600))) return true;   // ikki marta bosildi

    const raw = await redis.get(key);
    await redis.del(key);
    if (!accept) { await bot.sendMessage(chatId, "❌ Bekor qilindi."); return true; }
    if (!raw) { await bot.sendMessage(chatId, "⌛ Vaqti o'tgan. Ovozni qayta yuboring."); return true; }

    let payload;
    try { payload = JSON.parse(raw); } catch { await bot.sendMessage(chatId, "⌛ Vaqti o'tgan. Ovozni qayta yuboring."); return true; }

    try {
        if (kind === "sale") {
            // Tasdiqdan keyin ham qayta tekshiruv: parse bo'lmasa saqlanmaydi
            if (!parseSaleMessage(payload.text).items.length) throw new VoiceError("AI_INVALID_OUTPUT");
            await processSaleInput(bot, q.message, payload.text, seller, { tryAI: false });
        } else {
            await finishVoiceExpense(bot, chatId, userId, seller, payload.data);
        }
    } catch (e) {
        logVoiceError(`${kind}-confirm`, e);
        await bot.sendMessage(chatId, voiceErrorText(e));
    }
    return true;
}

module.exports = {
    routeVoiceMessage,
    confirmVoicePending,
    // test uchun
    _internals: { verifySale, verifyExpense, looksLikeSaleSpeech, validateVoiceMeta, voiceErrorText, esc, dbKey, finishVoiceExpense },
};
