// src/bot.js
require("./bootstrap/guard");

const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, GROUP_CHAT_ID } = require("./config");
const { onCallback } = require("./handlers/onCallback");
const { onMessage } = require("./handlers/onMessage");

const BOT_USERNAME = "totlisang_bot"; // ✅ o'zingizniki: @totlisang_bot. (bu yerda @siz yozmaysiz)
const STARTAPP_PAYLOAD = "totli";     // xohlasangiz o'zgartiring

function createSafePollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 300,
            autoStart: true,
            params: { timeout: 60 },
        },
        request: { timeout: 60000 },
    });

    // ✅ webhook conflict bo‘lmasin
    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => { });

    bot.on("polling_error", async (err) => {
        const msg = err?.message || String(err);
        console.error(`${name}_POLLING_ERROR:`, msg);

        // ⚠️ 409 Conflict: faqat 1 ta instance ishlashi kerak
        if (msg.includes("409 Conflict")) {
            console.error("❌ 409 Conflict: boshqa joyda ham bot ishlayapti. 1ta instance qoldiring.");
            return;
        }

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

// ✅ pinned xabarni GRUPPADA tekshiradi va kerak bo‘lsa yaratib pin qiladi
async function ensurePinnedMiniAppLinkInGroup(bot) {
    const groupId = GROUP_CHAT_ID;
    const miniAppDeepLink = `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP_PAYLOAD)}`;

    if (!groupId) {
        console.log("⚠️ GROUP_CHAT_ID yo‘q (.env)");
        return;
    }

    try {
        const chat = await bot.getChat(groupId);
        const pinned = chat?.pinned_message;

        // pinned ichida web_app tugmasi borligini tekshiramiz
        const kb = pinned?.reply_markup?.inline_keyboard || [];
        const flat = kb.flat();

        const hasSameLink = flat.some((b) => b?.url === miniAppDeepLink);

        if (pinned && hasSameLink) {
            console.log("✅ Group pinned Mini App link already exists");
            return;
        }

        // pinned bor-u, lekin bizga kerak tugma yo‘q => unpin qilib yangisini pin qilamiz
        if (pinned?.message_id) {
            await bot.unpinChatMessage(groupId, { message_id: pinned.message_id }).catch(() => { });
        }

        const text =
            "📊 <b>TOTLI Hisobotlar</b>\n\n" +
            "Bugungi tushum, chiqim va balans holatini onlayn kuzatib boring.\n" +
            "👇 Pastdagi tugmani bosing:";

        const sent = await bot.sendMessage(groupId, text, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📊 Hisobotlarni ko‘rish (Mini App)", url: miniAppDeepLink }],
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

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");

    const bot = createSafePollingBot(BOT_TOKEN, "ADMIN");

    // ✅ Bot ishga tushishi bilan tekshiradi
    ensurePinnedMiniAppLinkInGroup(bot).catch(() => { });

    // ✅ Har /start bo‘lganda ham tekshiradi (kim yozsa ham)
    bot.onText(/\/start/, async () => {
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => { });
    });

    bot.on("callback_query", (q) => onCallback(bot, q));
    bot.on("message", (msg) => onMessage(bot, msg));

    return bot;
}

module.exports = { createBot };