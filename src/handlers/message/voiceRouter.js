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

// ── Asosiy router ────────────────────────────────────────
async function routeVoiceMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const rawMode    = await getMode(userId);
    const mode       = !rawMode || rawMode === "menu" ? "sale" : rawMode;

    if (mode === "expense") return handleExpenseVoice(bot, msg);
    if (mode === "sale")    return handleSaleVoice(bot, msg);

    return bot.sendMessage(chatId,
        "⚠️ Ovoz faqat sotuv yoki chiqim rejimida ishlaydi.\n" +
        "Tugmalardan birini tanlang: 🧁 Sotish yoki 💸 Chiqim"
    );
}

// ── SOTUV — ovoz ────────────────────────────────────────
async function handleSaleVoice(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const seller = { tgId: userId, tgName: getUserName(msg) };

    const waitMsg = await bot.sendMessage(chatId,
        "🎤 <b>Ovoz qabul qilindi</b>\n⏳ Matniga o'girmoqda...",
        { parse_mode: "HTML" }
    ).catch(() => null);

    try {
        // 1. STT — ovoz → matn
        const spoken = await transcribeTelegramVoice(bot, msg.voice.file_id);

        if (!spoken || spoken.length < 3) {
            await bot.editMessageText(
                "❌ Ovozdan matn olinmadi.\n\nGapirib ko'rsating:\n<i>\"Tort Shokoladniy yuz yigirma ming, Pepsi o'n yetti ming\"</i>",
                { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
            ).catch(() => bot.sendMessage(chatId, "❌ Ovozdan matn olinmadi."));
            return;
        }

        // 2. Matnni ko'rsatamiz
        await bot.editMessageText(
            `🎤 <b>Eshitildi:</b> <i>${spoken}</i>\n\n⚙️ AI tahlil qilmoqda...`,
            { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
        ).catch(() => {});

        // 3. AI normalizatsiya
        const normalized = await normalizeSaleTextWithAI(spoken);

        if (!normalized) {
            await bot.sendMessage(chatId,
                `⚠️ Sotuv aniqlanmadi.\n\n🎤 Eshitildi: <i>${spoken}</i>\n\n` +
                "Aniqroq ayting:\n<i>\"Tort Napoleon yuz qirq ming, berdi uch yuz ming\"</i>",
                { parse_mode: "HTML" }
            );
            return;
        }

        // 4. Natijani ko'rsatib, saqlash
        await bot.editMessageText(
            `✅ <b>Tahlil qilindi:</b>\n<code>${normalized}</code>`,
            { chat_id: chatId, message_id: waitMsg?.message_id, parse_mode: "HTML" }
        ).catch(() => {});

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
