const { mainMenuKeyboard, startKeyboard } = require("../../keyboards");
const { isAuthed, setAuthed, setMode, checkPassword, redis } = require("../../services/auth");

async function handleTopCommands(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();

    if (text === "/tozalash") {
        await Promise.all([
            redis.del(`await_pay_amount:${userId}`),
            redis.del(`await_del:${userId}`),
            redis.del(`pur_state:${userId}`),
            redis.del(`exp_state:${userId}`),
            redis.del(`await_cashback:${userId}`),
        ]);

        await setMode(userId, "sale");
        await bot.sendMessage(
            chatId,
            "🧹 Bekor qilindi. Endi sotuvni yozishingiz yoki voice yuborishingiz mumkin.",
            { reply_markup: mainMenuKeyboard() }
        );
        return true;
    }

    if (text === "/start") {
        const ok = await isAuthed(userId);
        if (ok) {
            await setMode(userId, "sale");
            await bot.sendMessage(
                chatId,
                "🧁 Bot tayyor. Sotuvni yozishingiz yoki voice yuborishingiz mumkin.",
                { reply_markup: mainMenuKeyboard() }
            );
            return true;
        }

        const passOk = await checkPassword(userId, "");
        if (passOk) {
            await setAuthed(userId);
            await setMode(userId, "sale");
            await bot.sendMessage(
                chatId,
                "🧁 Bot tayyor. Sotuvni yozishingiz yoki voice yuborishingiz mumkin.",
                { reply_markup: mainMenuKeyboard() }
            );
            return true;
        }

        await setMode(userId, "await_password");
        await bot.sendMessage(chatId, "🔑 Parolni kiriting:");
        return true;
    }

    if (text.startsWith("/")) {
        return true;
    }

    return false;
}

async function handlePasswordStep(bot, msg, mode) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();

    if (mode !== "await_password") return false;

    const ok = await checkPassword(userId, text);
    if (ok) {
        await setAuthed(userId);
        await setMode(userId, "sale");
        await bot.sendMessage(
            chatId,
            "🧁 Bot tayyor. Sotuvni yozishingiz yoki voice yuborishingiz mumkin.",
            { reply_markup: mainMenuKeyboard() }
        );
        return true;
    }

    await bot.sendMessage(chatId, "❌ Noto‘g‘ri parol. Qayta kiriting:");
    return true;
}

module.exports = { handleTopCommands, handlePasswordStep };