// src/services/pinMessage.js
const { WEBAPP_URL } = require("../config");

let _lastPinCheck = 0;
let _sentMessageId = null; // oxirgi yuborilgan xabar ID

async function ensurePinnedMiniAppLinkInGroup(bot, forceSend = false) {
    const rawId = (process.env.GROUP_CHAT_ID || "").trim();
    if (!rawId || rawId === "-") {
        console.warn("⚠️ [pin] GROUP_CHAT_ID yo'q yoki bo'sh");
        return { ok: false };
    }

    // Supergroup ID — manfiy bo'lishi shart
    const groupId = rawId.startsWith("-") ? rawId : `-${rawId}`;

    // Throttle — forceSend bo'lmasa 1 soatda 1 marta
    const now = Date.now();
    if (!forceSend && now - _lastPinCheck < 3600_000) {
        return { ok: true, skipped: true };
    }
    _lastPinCheck = now;

    const base     = (WEBAPP_URL || "https://totli-inky.vercel.app").replace(/\/+$/, "");
    const dashUrl  = base;
    const printUrl = base + "/print";

    try {
        // ── Tekshirish: eski pinimiz bormi ──────────────
        if (!forceSend && _sentMessageId) {
            // Avval yuborilgan xabarimiz hali pin bo'lsa — chiqamiz
            try {
                const chat   = await bot.getChat(groupId);
                const pinned = chat?.pinned_message;
                if (pinned?.message_id === _sentMessageId) {
                    console.log("✅ [pin] Pin hali turibdi — tegmadik");
                    return { ok: true, updated: false };
                }
            } catch {}
        }

        // ── Yangi xabar yuborish ─────────────────────────
        const d    = new Date(new Date().toLocaleString("en", { timeZone: "Asia/Tashkent" }));
        const date = `${d.getDate()}.${String(d.getMonth()+1).padStart(2,"0")}.${d.getFullYear()}`;

        const text =
        `📈 <b>TOTLI boshqaruv paneliga kirish</b>\n` ;

        const sent = await bot.sendMessage(groupId, text, {
    parse_mode: "HTML",
    reply_markup: {
        inline_keyboard: [
            [
                {
                    text: "📊 Hisobotlar",
                    url: "https://t.me/totlisang_bot?startapp",
                }
            ]
        ]
    },
    disable_web_page_preview: true,
});

        _sentMessageId = sent.message_id;
        console.log(`📤 [pin] Xabar yuborildi: ${sent.message_id}`);

        // ── Pin qilish ───────────────────────────────────
        try {
            await bot.pinChatMessage(groupId, sent.message_id, {
                disable_notification: true,
            });
            console.log("📌 [pin] Pin qilindi ✅");
        } catch (pinErr) {
            const pm = pinErr?.message || "";
            if (pm.includes("not enough rights") || pm.includes("CHAT_ADMIN_REQUIRED")) {
                console.warn("⚠️ [pin] Bot 'Pin messages' ruxsatiga ega emas — admin sozlamalarida yoqing");
            } else {
                console.warn("⚠️ [pin] Pin xato:", pm);
            }
        }

        return { ok: true, updated: true, messageId: sent.message_id };

    } catch (e) {
        const em = e?.message || String(e);
        if (em.includes("chat not found"))   console.error(`❌ [pin] Guruh topilmadi (${groupId}) — bot guruhga qo'shilganmi?`);
        else if (em.includes("Forbidden"))   console.error(`❌ [pin] Bot guruhga xabar yubora olmaydi — admin qiling`);
        else if (em.includes("ETIMEDOUT"))   console.warn(`⚠️ [pin] Tarmoq xatosi — keyingi tekshirishda urinadi`);
        else                                  console.error(`❌ [pin] Xato:`, em);
        return { ok: false, error: em };
    }
}

function schedulePinChecker(bot) {
    // Bot ishga tushgandan 15 soniya keyin
    setTimeout(() => ensurePinnedMiniAppLinkInGroup(bot).catch(() => {}), 15_000);

    // Har 2 soatda tekshiradi
    setInterval(() => {
        _lastPinCheck = 0;
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => {});
    }, 2 * 60 * 60 * 1000);

    console.log("📌 [pin] Scheduler ishga tushdi — har 2 soatda tekshiradi");
}

module.exports = { ensurePinnedMiniAppLinkInGroup, schedulePinChecker };
