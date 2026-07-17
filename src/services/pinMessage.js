// src/services/pinMessage.js
// Guruhga pin xabar yuborish

const { GROUP_CHAT_ID, WEBAPP_URL, CUSTOMER_BOT_USERNAME } = require("../config");

async function ensurePinnedMiniAppLinkInGroup(bot) {
    const groupId = GROUP_CHAT_ID;

    // GROUP_CHAT_ID bo'sh bo'lsa — ogohlantirish va chiqish
    if (!groupId) {
        console.warn("⚠️ [pinMessage] GROUP_CHAT_ID .env da yo'q — pin qilinmadi");
        return { ok: false, error: "GROUP_CHAT_ID empty" };
    }

    // Admin bot username ni botdan olamiz — env dan emas
    let adminBotUsername = "";
    try {
        const me = await bot.getMe();
        adminBotUsername = me.username || "";
    } catch (e) {
        console.error("❌ [pinMessage] bot.getMe() xato:", e?.message);
        return { ok: false, error: e?.message };
    }

    const webappBase   = WEBAPP_URL ? String(WEBAPP_URL).replace(/\/+$/, "") : "";
    const dashboardUrl = webappBase || `https://t.me/${adminBotUsername}?startapp=dashboard`;
    const printUrl     = webappBase ? webappBase + "/print" : null;

    try {
        const chat   = await bot.getChat(groupId);
        const pinned = chat?.pinned_message;

        // Tugmalarni tekshirish — allaqachon to'g'ri pin bormi?
        const kb   = pinned?.reply_markup?.inline_keyboard || [];
        const flat = kb.flat();
        const hasOurLink = flat.some(b =>
            b?.url === dashboardUrl ||
            b?.web_app?.url === printUrl ||
            (b?.url && b.url.includes("startapp=dashboard"))
        );

        if (pinned && hasOurLink) {
            console.log("✅ [pinMessage] Pin allaqachon mavjud — tegmadik");
            return { ok: true, updated: false };
        }

        // Eski pinni yechamiz
        if (pinned?.message_id) {
            await bot.unpinChatMessage(groupId, { message_id: pinned.message_id }).catch(() => {});
        }

        // Yangi pin xabar
        const text  = "📊 <b>TOTLI — Boshqaruv markazi</b>\n\n👇 Kerakli tugmani bosing:";
        const newKb = [[{ text: "📊 Dashboard", web_app: { url: dashboardUrl } }]];
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
        }).catch((e) => {
            console.warn("⚠️ [pinMessage] pinChatMessage xato (bot admin emasmi?):", e?.message);
        });

        console.log("📌 [pinMessage] Pin xabar yuborildi va pin qilindi");
        return { ok: true, updated: true };

    } catch (e) {
        console.error("❌ [pinMessage] Xato:", e?.message || e);
        return { ok: false, error: e?.message };
    }
}

module.exports = { ensurePinnedMiniAppLinkInGroup };
