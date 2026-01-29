const { GROUP_CHAT_ID } = require("../config");

async function sendToGroup(bot, text, opts = {}) {
    if (!GROUP_CHAT_ID) return;
    await bot.sendMessage(GROUP_CHAT_ID, text, { parse_mode: "HTML", ...opts });
}

module.exports = { sendToGroup };
