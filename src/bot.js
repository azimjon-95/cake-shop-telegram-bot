const { scheduleDailyAt2330 }    = require('./services/backupScheduler');
const { scheduleStatsNotifier }  = require('./services/statsNotifier');
// src/bot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, GROUP_CHAT_ID } = require("./config");
const { onCallback } = require("./handlers/onCallback");
const { onMessage } = require("./handlers/onMessage");
const { saveSeenUser } = require("./logic/saveSeenUser");

const BOT_USERNAME = "totlisang_bot";
const STARTAPP_PAYLOAD = "totli";

function createSafePollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 300,
            autoStart: true,
            params: { timeout: 60 },
        },
        request: { timeout: 60000 },
    });

    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    bot.on("polling_error", async (err) => {
        const msg = err?.message || String(err);
        console.error(`${name}_POLLING_ERROR:`, msg);

        if (msg.includes("409 Conflict")) {
            console.error("❌ 409 Conflict: faqat 1ta bot instance ishlashi kerak.");
            return;
        }

        const isNet =
            msg.includes("ETIMEDOUT") ||
            msg.includes("EAI_AGAIN") ||
            msg.includes("ECONNRESET") ||
            msg.includes("socket hang up") ||
            msg.includes("ENOTFOUND");

        if (isNet) {
            console.warn("[bot] Network error, restarting polling in 3s...");
            try { await bot.stopPolling(); } catch { }
            setTimeout(() => bot.startPolling().catch(() => { }), 3000);
        }
    });

    return bot;
}

// ✅ Global uncaught error — bot o'lmasin
process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err?.message || err);
});
process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason?.message || reason);
});

async function ensurePinnedMiniAppLinkInGroup(bot) {
    const groupId = GROUP_CHAT_ID;
    const miniAppDeepLink = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP_PAYLOAD)}`;

    if (!groupId) return;

    try {
        const chat = await bot.getChat(groupId);
        const pinned = chat?.pinned_message;
        const kb = pinned?.reply_markup?.inline_keyboard || [];
        const flat = kb.flat();
        const hasSameLink = flat.some((b) => b?.url === miniAppDeepLink);

        if (pinned && hasSameLink) {
            console.log("✅ Group pinned Mini App link already exists");
            return;
        }

        if (pinned?.message_id) {
            await bot.unpinChatMessage(groupId, { message_id: pinned.message_id }).catch(() => { });
        }

        const text =
            "📊 <b>TOTLI Hisobotlar</b>\n\n" +
            "Bugungi tushum, chiqim va balans holatini onlayn kuzating.\n" +
            "👇 Pastdagi tugmani bosing:";

        const sent = await bot.sendMessage(groupId, text, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Hisobotlarni ko'rish (Mini App)", url: miniAppDeepLink }],
                ],
            },
            disable_web_page_preview: true,
        });

        await bot.pinChatMessage(groupId, sent.message_id, {
            disable_notification: true,
        }).catch(() => { });

        console.log("📌 Group pinned message created/updated");
    } catch (e) {
        console.error("❌ ensurePinnedMiniAppLinkInGroup error:", e?.message || e);
    }
}

async function safeHandleMessage(bot, msg) {
    try {
        await saveSeenUser(msg);
        await onMessage(bot, msg);
    } catch (e) {
        console.error("[onMessage error]", e?.message || e);
        try {
            await bot.sendMessage(msg.chat.id, "⚠️ Ichki xatolik yuz berdi. Qayta urinib ko'ring.");
        } catch { }
    }
}

async function safeHandleCallback(bot, q) {
    try {
        await onCallback(bot, q);
    } catch (e) {
        console.error("[onCallback error]", e?.message || e);
        try {
            await bot.answerCallbackQuery(q.id, { text: "⚠️ Xatolik yuz berdi", show_alert: true });
        } catch { }
    }
}

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q (.env)");

    const bot = createSafePollingBot(BOT_TOKEN, "TOTLI_BOT");

    ensurePinnedMiniAppLinkInGroup(bot).catch(() => { });
    scheduleDailyAt2330(bot);    // ✅ Kunlik backup
    scheduleStatsNotifier(bot);  // ✅ Kunlik 2x statistika SMS

    bot.onText(/\/start/, async () => {
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => { });
    });

    bot.on("callback_query", (q) => safeHandleCallback(bot, q));
    bot.on("message", (msg) => safeHandleMessage(bot, msg));

    return bot;
}

module.exports = { createBot };
