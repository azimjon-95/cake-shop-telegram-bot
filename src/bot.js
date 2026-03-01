// src/bot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN } = require("./config");
const { onCallback } = require("./handlers/onCallback");
const { onMessage } = require("./handlers/onMessage");

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");

    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // ✅ polling bilan konflikt bo‘lmasin
    await bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    bot.on("polling_error", (err) => {
        console.error("ADMIN_POLLING_ERROR:", err?.message);
        console.dir(err, { depth: 5 });
        if (err?.cause) console.error("CAUSE:", err.cause);
        if (err?.errors) console.error("ERRORS:", err.errors);
    });

    bot.on("callback_query", (q) => onCallback(bot, q));
    bot.on("message", (msg) => onMessage(bot, msg));

    return bot;
}

module.exports = { createBot };