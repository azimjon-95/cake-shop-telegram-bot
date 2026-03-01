// src/customerBot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { CUSTOMER_BOT_TOKEN } = require("./config");
const { onCustomerStart } = require("./handlers/customerStart");

function createSafePollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 300,
            autoStart: true,
            params: { timeout: 60 },
        },
        request: {
            timeout: 60000,
        },
    });

    // ✅ webhook conflict bo‘lmasin
    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    bot.on("polling_error", async (err) => {
        const msg = err?.message || String(err);
        console.error("CUSTOMER_POLLING_ERROR:", msg);

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

async function createCustomerBot() {
    if (!CUSTOMER_BOT_TOKEN) throw new Error("CUSTOMER_BOT_TOKEN yo'q");

    const bot = createSafePollingBot(CUSTOMER_BOT_TOKEN, "CUSTOMER");

    bot.onText(/\/start(?:\s+(.+))?/i, (msg, match) => {
        return onCustomerStart(bot, msg, match?.[1]);
    });

    return bot;
}

module.exports = { createCustomerBot };