const { getMode, setMode, redis } = require("../../services/auth");
const { getUserName } = require("../../logic/ui");
const { transcribeTelegramVoice } = require("../../services/stt");
const { processSaleInput } = require("./saleMessage");
const { isLikelySaleText, saleWarningText } = require("../../services/saleGuard");
const { getVoiceFallbackText, expenseCategoryTitle } = require("./helpers");
const { normalizeExpenseVoiceText } = require("../../services/aiExpense");
const { REQUIRED_DESCRIPTION_CATEGORIES } = require("../expenseFlow");
const { saveExpenseWithTx } = require("../../logic/storage");
const { expenseNotifyText } = require("../../utils/report");
const { sendToGroup } = require("../../services/notify");
const { formatMoney } = require("../../utils/money");

async function routeVoiceMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    const rawMode = await getMode(userId);
    const currentMode = !rawMode || rawMode === "menu" ? "sale" : rawMode;

    if (currentMode === "expense") {
        return handleExpenseVoice(bot, msg);
    }

    if (currentMode === "sale") {
        return handleSaleVoice(bot, msg);
    }

    return bot.sendMessage(
        chatId,
        "⚠️ Voice faqat sotuv yoki chiqim jarayonida ishlaydi.\nAvval kerakli bo‘limni tanlang."
    );
}

async function handleSaleVoice(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const seller = { tgId: userId, tgName: getUserName(msg) };

    try {
        await bot.sendMessage(chatId, "🎤 Voice qabul qilindi, tahlil qilinmoqda...");

        const spokenText = await transcribeTelegramVoice(bot, msg.voice.file_id);

        if (!spokenText) {
            return bot.sendMessage(chatId, "❌ Voice’dan matn olinmadi. Qayta gapirib yuboring.");
        }

        if (!isLikelySaleText(spokenText)) {
            return bot.sendMessage(chatId, saleWarningText());
        }

        return processSaleInput(bot, msg, spokenText, seller, { tryAI: true });
    } catch (e) {
        console.error("VOICE_SALE_ERROR:", e);
        return bot.sendMessage(chatId, getVoiceFallbackText(e));
    }
}

async function handleExpenseVoice(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    try {
        await bot.sendMessage(chatId, "🎤 Voice qabul qilindi, chiqim tahlil qilinmoqda...");

        const spokenText = await transcribeTelegramVoice(bot, msg.voice.file_id);
        if (!spokenText) {
            return bot.sendMessage(chatId, "❌ Voice’dan matn olinmadi. Qayta gapirib yuboring.");
        }

        const data = await normalizeExpenseVoiceText(spokenText);

        const categoryKey = String(data?.categoryKey || "").trim();
        const amount = Number(data?.amount || 0);
        const description = String(data?.description || "").trim();

        if (!categoryKey || !amount) {
            return bot.sendMessage(
                chatId,
                "⚠️ Chiqim aniqlanmadi.\nIltimos kategoriya va summani aniq ayting.\n\nMasalan:\nTaksiga 25 ming\nUstaga 120 ming eshik tuzatish"
            );
        }

        if (categoryKey === "supplier") {
            await redis.set(
                `exp_state:${userId}`,
                JSON.stringify({
                    step: "await_supplier_amount_from_voice",
                    amount
                }),
                "EX",
                600
            );

            return bot.sendMessage(
                chatId,
                "🏷 Firma (Taminotga) uchun ro‘yxatdan firmani tanlang."
            );
        }

        if (REQUIRED_DESCRIPTION_CATEGORIES.has(categoryKey) && !description) {
            await redis.set(
                `exp_state:${userId}`,
                JSON.stringify({
                    step: "await_description",
                    categoryKey,
                    amount
                }),
                "EX",
                600
            );

            return bot.sendMessage(
                chatId,
                `✏️ <b>${expenseCategoryTitle(categoryKey)}</b> uchun description majburiy.\nMasalan: Bodiring / Usta haqi / Material`,
                { parse_mode: "HTML" }
            );
        }

        const spender = { tgId: userId, tgName: getUserName(msg) };
        const title = expenseCategoryTitle(categoryKey);

        const exp = await saveExpenseWithTx({
            spender,
            title,
            amount,
            categoryKey,
            description
        });

        const notify = expenseNotifyText({
            spenderName: spender.tgName,
            title,
            amount
        });

        await bot.sendMessage(
            chatId,
            `✅ <b>Chiqim saqlandi</b>\n🆔 ID: <code>${exp.orderNo || "-"}</code>\n💸 Summa: <b>${formatMoney(amount)}</b> so'm\n📂 Kategoriya: <b>${title}</b>`,
            { parse_mode: "HTML" }
        );

        await sendToGroup(bot, notify);
        await setMode(userId, "sale");
        return true;
    } catch (e) {
        console.error("VOICE_EXPENSE_ERROR:", e);
        return bot.sendMessage(chatId, getVoiceFallbackText(e));
    }
}

module.exports = { routeVoiceMessage };