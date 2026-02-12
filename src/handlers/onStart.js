// src/handlers/onStart.js
const { mainMenuKeyboard } = require("../keyboards");
const { isAuthed, setMode } = require("../services/auth");

async function onStart(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    const ok = await isAuthed(userId);

    if (ok) {
        await setMode(userId, "menu");
        return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
    }

    await setMode(userId, "await_password");
    return bot.sendMessage(chatId, "🔑 Parolni kiriting:");
}

module.exports = { onStart };
