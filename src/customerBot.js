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

    // Spam oldini olish — bir xil xato 30s da bir marta loglanadi
    const _errCount = {};
    const _errLast  = {};
    const LOG_IV    = 30_000;

    bot.on("polling_error", async (err) => {
        const raw = err?.message || String(err);

        // 409 — serverda bot hali ishlayapti (lokal dev paytida normal)
        if (raw.includes("409 Conflict")) {
            const now = Date.now();
            _errCount["409"] = (_errCount["409"] || 0) + 1;
            if (!_errLast["409"] || now - _errLast["409"] > LOG_IV) {
                _errLast["409"] = now;
                console.warn(
                     +
                    "Serverda bot ishlayapti — lokal test uchun: pm2 stop cake"
                );
            }
            return;
        }

        const isNet = raw.includes("ETIMEDOUT") || raw.includes("ESOCKETTIMEDOUT") ||
                      raw.includes("ECONNRESET") || raw.includes("EAI_AGAIN") ||
                      raw.includes("ENOTFOUND")  || raw.includes("socket hang up");

        if (isNet) {
            const now = Date.now();
            _errCount["NET"] = (_errCount["NET"] || 0) + 1;
            if (!_errLast["NET"] || now - _errLast["NET"] > LOG_IV) {
                _errLast["NET"] = now;
                console.warn();
            }
            const delay = Math.min(60_000, 3000 * Math.pow(2, (_errCount["NET"] || 1) - 1));
            try { await bot.stopPolling(); } catch {}
            setTimeout(() => {
                bot.startPolling().then(() => {
                    _errCount["NET"] = 0;
                    delete _errLast["NET"];
                }).catch(() => {});
            }, delay);
            return;
        }

        // Boshqa xatolar — bir marta
        const key = "OTHER_" + raw.slice(0, 20);
        const now = Date.now();
        if (!_errLast[key] || now - _errLast[key] > LOG_IV) {
            _errLast[key] = now;
            console.error("[CUSTOMER_BOT] ❌", raw);
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