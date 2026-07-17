// src/bot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, GROUP_CHAT_ID, WEBAPP_URL } = require("./config");
const { onCallback }   = require("./handlers/onCallback");
const { onMessage }    = require("./handlers/onMessage");
const { saveSeenUser } = require("./logic/saveSeenUser");
const { webAppButtons } = require("./keyboards");

const { scheduleDailyAt2330 }    = require("./services/backupScheduler");
const { scheduleStatsNotifier }  = require("./services/statsNotifier");
const { onGroupPhoto, scheduleInstagramPost } = require("./services/instagramCollector");
const { scheduleSmartNotifier }  = require("./services/smartNotifier");
const { ensurePinnedMiniAppLinkInGroup } = require("./services/pinMessage");

// ── Global uncaught — bot o'lmasin ──────────────────────
process.on("uncaughtException",  (err) => console.error("[uncaughtException]",  err?.message || err));
process.on("unhandledRejection", (r)   => console.error("[unhandledRejection]", r?.message   || r));

// ── Polling xato tracker — spam oldini olish ─────────────
const _errTracker = {
    counts:   {},   // { "409": 3, "ETIMEDOUT": 2 }
    lastLog:  {},   // { "409": timestamp }
    LOG_INTERVAL: 30_000, // bir xil xato faqat 30s da bir loglandi
    track(code) {
        this.counts[code]  = (this.counts[code]  || 0) + 1;
        const last         = this.lastLog[code]  || 0;
        const now          = Date.now();
        const shouldLog    = now - last > this.LOG_INTERVAL;
        if (shouldLog) {
            this.lastLog[code] = now;
            return { log: true, count: this.counts[code] };
        }
        return { log: false };
    },
    reset(code) {
        this.counts[code]  = 0;
        delete this.lastLog[code];
    }
};

// ── Network qayta ulanish holati ──────────────────────────
let _netRetry = 0;
let _netDown  = false;

function createSafePollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 1000,
            autoStart: true,
            params: { timeout: 30, allowed_updates: ["message", "callback_query"] },
        },
        request: {
            timeout: 35000,
            agentOptions: { keepAlive: true, keepAliveMsecs: 15000 },
        },
    });

    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => {});

    bot.on("polling_error", async (err) => {
        const raw = err?.message || String(err);

        // ── 409 Conflict: boshqa instance ishlayapti ────────
        if (raw.includes("409 Conflict")) {
            const t = _errTracker.track("409");
            if (t.log) {
                console.warn(
                    `[${name}] ⚠️ 409 Conflict (${t.count}x): ` +
                    "Serverda bot ishlayapti. Lokal test uchun serverda to'xtating: pm2 stop cake"
                );
            }
            return;
        }

        // ── 404 Not Found: token noto'g'ri ──────────────────
        if (raw.includes("404 Not Found")) {
            const t = _errTracker.track("404");
            if (t.log) console.error(`[${name}] ❌ 404: BOT_TOKEN noto'g'ri yoki bot o'chirilgan`);
            return;
        }

        // ── Tarmoq xatolari: ETIMEDOUT, ECONNRESET, ESOCKETTIMEOUT ──
        const isNet = raw.includes("ETIMEDOUT") || raw.includes("ESOCKETTIMEDOUT") ||
                      raw.includes("ECONNRESET") || raw.includes("EAI_AGAIN") ||
                      raw.includes("ENOTFOUND")  || raw.includes("socket hang up");

        if (isNet) {
            const t = _errTracker.track("NET");
            if (!t.log) return; // spam oldini olish

            if (!_netDown) {
                _netDown = true;
                console.warn(`[${name}] 📵 Internet uzildi (${t.count}x) — qayta ulanmoqda...`);
                if (GROUP_CHAT_ID) {
                    bot.sendMessage(GROUP_CHAT_ID,
                        "⚠️ <b>Internet muammo!</b> Bot vaqtincha javob bermaydi.",
                        { parse_mode: "HTML" }
                    ).catch(() => {});
                }
            }

            // Exponential backoff: 3s → 6s → 12s → max 60s
            _netRetry++;
            const delay = Math.min(60_000, 3000 * Math.pow(2, _netRetry - 1));

            try { await bot.stopPolling(); } catch {}
            setTimeout(async () => {
                try {
                    await bot.startPolling();
                    _netDown  = false;
                    _netRetry = 0;
                    _errTracker.reset("NET");
                    console.log(`[${name}] ✅ Internet qaytdi — polling tiklandi`);
                    if (GROUP_CHAT_ID) {
                        bot.sendMessage(GROUP_CHAT_ID,
                            "✅ <b>Internet qaytdi!</b> Bot yana ishlayapti.",
                            { parse_mode: "HTML" }
                        ).catch(() => {});
                    }
                } catch {}
            }, delay);
            return;
        }

        // ── Boshqa xatolar: bir marta loglaymiz ──────────────
        const t = _errTracker.track("OTHER_" + raw.slice(0, 20));
        if (t.log) console.error(`[${name}] ❌ Polling xato:`, raw);
    });

    return bot;
}

async function safeHandleMessage(bot, msg) {
    try {
        await saveSeenUser(msg);
        await onMessage(bot, msg);
    } catch (e) {
        console.error("[onMessage error]", e?.message || e);
        try { await bot.sendMessage(msg.chat.id, "⚠️ Ichki xatolik. Qayta urinib ko'ring."); } catch {}
    }
}

async function safeHandleCallback(bot, q) {
    try {
        await onCallback(bot, q);
    } catch (e) {
        const msg = e?.message || String(e);
        const isNet = msg.includes("ETIMEDOUT") || msg.includes("ECONNRESET") ||
                      msg.includes("socket hang up") || msg.includes("EAI_AGAIN");
        console.error("[onCallback error]", msg);
        if (!isNet) {
            try { await bot.answerCallbackQuery(q.id, { text: "⚠️ Xatolik, qayta bosing" }); } catch {}
        }
    }
}

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q (.env)");

    const bot = createSafePollingBot(BOT_TOKEN, "TOTLI_BOT");

    ensurePinnedMiniAppLinkInGroup(bot).catch(() => {});
    scheduleDailyAt2330(bot);
    scheduleStatsNotifier(bot);
    scheduleInstagramPost(bot);
    scheduleSmartNotifier(bot);

    bot.onText(/\/start/, async () => {
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => {});
    });

    bot.on("callback_query", (q) => safeHandleCallback(bot, q));
    bot.on("message", (msg) => {
        if (msg.photo) onGroupPhoto(bot, msg).catch(() => {});
        safeHandleMessage(bot, msg);
    });

    return bot;
}

module.exports = { createBot };
