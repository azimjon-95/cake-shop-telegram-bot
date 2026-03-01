// src/bot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN } = require("./config");
const { onCallback } = require("./handlers/onCallback");
const { onMessage } = require("./handlers/onMessage");

function createSafePollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 300,          // 300ms — yaxshi
            autoStart: true,
            params: { timeout: 60 } // long-polling timeout (sec)
        },
        request: {
            timeout: 60000,         // HTTP timeout (ms)
        },
    });

    // ✅ webhook conflict bo‘lmasin (polling uchun)
    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    // ✅ polling error bo‘lsa bot yiqilmasin, qayta start qilsin
    bot.on("polling_error", async (err) => {
        const msg = err?.message || String(err);
        console.error("ADMIN_POLLING_ERROR:", msg);

        // debug (xohlasang qoldir)
        // console.dir(err, { depth: 4 });

        // ETIMEDOUT / EAI_AGAIN / ECONNRESET -> internet/DNS vaqtinchalik
        const isNet =
            msg.includes("ETIMEDOUT") ||
            msg.includes("EAI_AGAIN") ||
            msg.includes("ECONNRESET") ||
            msg.includes("socket hang up") ||
            msg.includes("ENOTFOUND");

        if (isNet) {
            try { await bot.stopPolling(); } catch { }
            setTimeout(() => {
                bot.startPolling().catch(() => { });
            }, 3000);
        }
    });

    return bot;
}

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");

    const bot = createSafePollingBot(BOT_TOKEN, "ADMIN");

    bot.on("callback_query", (q) => onCallback(bot, q));
    bot.on("message", (msg) => onMessage(bot, msg));

    return bot;
}

module.exports = { createBot };