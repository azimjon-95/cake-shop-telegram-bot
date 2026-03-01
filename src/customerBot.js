// src/customerBot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { CUSTOMER_BOT_TOKEN } = require("./config");
const { onCustomerStart } = require("./handlers/customerStart");

async function createCustomerBot() {
    if (!CUSTOMER_BOT_TOKEN) throw new Error("CUSTOMER_BOT_TOKEN yo'q");

    const bot = new TelegramBot(CUSTOMER_BOT_TOKEN, { polling: true });

    // ✅ polling bilan konflikt bo‘lmasin
    await bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    bot.on("polling_error", (err) => {
        console.error("CUSTOMER_POLLING_ERROR:", err?.message);
        console.dir(err, { depth: 5 });
        if (err?.cause) console.error("CAUSE:", err.cause);
        if (err?.errors) console.error("ERRORS:", err.errors);
    });

    bot.onText(/\/start(?:\s+(.+))?/i, (msg, match) => {
        return onCustomerStart(bot, msg, match?.[1]);
    });

    return bot;
}

module.exports = { createCustomerBot };