// src/services/pinMessage.js
// Guruhga pin xabar yuborish — admin qo'lda ham, bot restart da ham chaqiradi

const { GROUP_CHAT_ID, WEBAPP_URL } = require("../config");

// BOT_USERNAME va STARTAPP_PAYLOAD ni bot.js dan olamiz (env orqali)
const BOT_USERNAME    = process.env.CUSTOMER_BOT_USERNAME?.replace("@", "") || "";
const STARTAPP_PAYLOAD = "dashboard";

async function ensurePinnedMiniAppLinkInGroup(bot) {
    const groupId = GROUP_CHAT_ID;
    if (!groupId) return;

    const miniAppDeepLink = `https://t.me/${process.env.BOT_USERNAME || BOT_USERNAME}?startapp=${encodeURIComponent(STARTAPP_PAYLOAD)}`;
    const printUrl = WEBAPP_URL
        ? String(WEBAPP_URL).replace(/\/+$/, "") + "/print"
        : null;

    try {
        const chat   = await bot.getChat(groupId);
        const pinned = chat?.pinned_message;
        const kb     = pinned?.reply_markup?.inline_keyboard || [];
        const flat   = kb.flat();
        const hasLink = flat.some(b => b?.url === miniAppDeepLink || b?.web_app?.url === printUrl);

        // Allaqachon to'g'ri pin bor — tegmaymiz
        if (pinned && hasLink) {
            console.log("✅ Pin xabar allaqachon mavjud");
            return { ok: true, updated: false };
        }

        // Eski pinni yechamiz
        if (pinned?.message_id) {
            await bot.unpinChatMessage(groupId, { message_id: pinned.message_id }).catch(() => {});
        }

        const text = "📊 <b>TOTLI — Boshqaruv markazi</b>\n\n👇 Kerakli tugmani bosing:";
        const newKb = [[{ text: "📊 Dashboard (Mini App)", url: miniAppDeepLink }]];
        if (printUrl) {
            newKb.push([{ text: "🖨 Print Station — Chek chiqarish", web_app: { url: printUrl } }]);
        }

        const sent = await bot.sendMessage(groupId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: newKb },
            disable_web_page_preview: true,
        });

        await bot.pinChatMessage(groupId, sent.message_id, {
            disable_notification: true,
        }).catch(() => {});

        console.log("📌 Pin xabar yaratildi/yangilandi");
        return { ok: true, updated: true };

    } catch (e) {
        console.error("❌ ensurePinnedMiniAppLinkInGroup:", e?.message || e);
        return { ok: false, error: e?.message };
    }
}

module.exports = { ensurePinnedMiniAppLinkInGroup };
