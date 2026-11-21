// Pin xabarni qo'lda sinash. Polling YO'Q — serverdagi bot bilan 409 Conflict bermaydi.
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { ensurePinnedMiniAppLinkInGroup } = require("./src/services/pinMessage");

(async () => {
    try {
        const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
        const result = await ensurePinnedMiniAppLinkInGroup(bot, true);
        console.log("📌 Pin natijasi:", result);
    } catch (e) {
        console.error("❌ XATO:", e?.message || e);
    }
    process.exit(0);
})();
