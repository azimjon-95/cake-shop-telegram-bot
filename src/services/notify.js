// services/notify.js
const { GROUP_CHAT_ID } = require("../config");

async function sendToGroup(bot, text, extra = {}) {
    if (!GROUP_CHAT_ID) return false;

    try {
        await bot.sendMessage(GROUP_CHAT_ID, text, {
            parse_mode: "HTML",
            ...extra,
        });
        return true;
    } catch (e) {
        // ❗ bot yiqilmasin, faqat log bo‘lsin
        const desc =
            e?.response?.body?.description ||
            e?.response?.body ||
            e?.message ||
            String(e);

        console.error("❌ sendToGroup error:", desc);
        return false;
    }
}

module.exports = { sendToGroup };
