// notify.js - sending notifications to Telegram group chat
// Har xabar tepasida filial nomi chiqadi: "🏪 Totli Sang" / "🏪 Totli To'da"
const { branchHeader, groupFor, currentBranch, normBranch, isTestBranch, TEST_BRANCH } = require("./branches");

// opts.branchId — berilmasa joriy filial (bot handler konteksti)
async function sendToGroup(bot, text, opts = {}) {
    const { branchId, noHeader, ...rest } = opts;
    const branch = normBranch(branchId || currentBranch());
    const chatId = groupFor(branch);
    if (!chatId) return;

    const body = noHeader ? String(text) : `${branchHeader(branch)}\n${text}`;
    await bot.sendMessage(chatId, body, { parse_mode: "HTML", ...rest });
}

// ── TEST filial: guruhga ketgan har qanday xabar TEST_GROUP_DELETE_SEC (60s) dan keyin o'chadi ──
// bot.send* ni o'raymiz: joriy filial TEST bo'lib, chat — TEST guruhi bo'lsa → o'chirishni rejalaymiz.
function installTestAutoDelete(bot) {
    if (!bot || bot.__testAutoDelete) return bot;
    bot.__testAutoDelete = true;

    const methods = ["sendMessage", "sendDocument", "sendPhoto", "sendMediaGroup", "sendVideoNote", "sendVideo"];
    for (const m of methods) {
        const orig = bot[m]?.bind(bot);
        if (!orig) continue;
        bot[m] = async (chatId, ...args) => {
            const res = await orig(chatId, ...args);
            try {
                if (currentBranch() === TEST_BRANCH && isTestBranch(TEST_BRANCH)) {
                    const g = groupFor(TEST_BRANCH);
                    if (g && String(chatId) === String(g)) {
                        const ms = Math.max(5, Number(process.env.TEST_GROUP_DELETE_SEC || 60)) * 1000;
                        const list = Array.isArray(res) ? res : [res];
                        for (const r of list) {
                            const mid = r?.message_id;
                            if (!mid) continue;
                            const t = setTimeout(() => bot.deleteMessage(chatId, mid).catch(() => {}), ms);
                            if (t.unref) t.unref();
                        }
                    }
                }
            } catch { /* o'chirish rejasi xatosi asosiy oqimni buzmasin */ }
            return res;
        };
    }
    return bot;
}

module.exports = { sendToGroup, installTestAutoDelete };
