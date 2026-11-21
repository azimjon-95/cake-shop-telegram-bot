// notify.js - sending notifications to Telegram group chat
// Har xabar tepasida filial nomi chiqadi: "🏪 Totli Sang" / "🏪 Totli To'da"
const { branchHeader, groupFor, currentBranch, normBranch } = require("./branches");

// opts.branchId — berilmasa joriy filial (bot handler konteksti)
async function sendToGroup(bot, text, opts = {}) {
    const { branchId, noHeader, ...rest } = opts;
    const branch = normBranch(branchId || currentBranch());
    const chatId = groupFor(branch);
    if (!chatId) return;

    const body = noHeader ? String(text) : `${branchHeader(branch)}\n${text}`;
    await bot.sendMessage(chatId, body, { parse_mode: "HTML", ...rest });
}

module.exports = { sendToGroup };
