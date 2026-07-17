// src/services/pinMessage.js
// Guruhga PIN xabar — har kuni bir marta tekshiriladi
// Bot admin bo'lishi va "Pin messages" ruxsati bo'lishi shart

const { WEBAPP_URL } = require("../config");

// ── Ichki holat — kun davomida bir marta yuborilsin ──────
let _lastPinCheck  = 0;        // ms
let _pinCheckGap   = 60 * 60 * 1000; // 1 soat — qayta tekshirish oralig'i

// ── Asosiy funksiya ──────────────────────────────────────
async function ensurePinnedMiniAppLinkInGroup(bot, forceSend = false) {
    // GROUP_CHAT_ID — .env dan olamiz (har safar yangi qiymat bo'lishi uchun)
    const rawId = process.env.GROUP_CHAT_ID || "";
    if (!rawId) {
        console.warn("⚠️ [pin] GROUP_CHAT_ID .env da yo'q");
        return { ok: false };
    }

    // Manfiy raqam bo'lishi shart (-100...)
    const groupId = rawId.startsWith("-") ? rawId : `-${rawId}`;

    // Vaqt filtri — tez-tez chaqirilsa ham bir soatda bir marta ishlaydi
    const now = Date.now();
    if (!forceSend && now - _lastPinCheck < _pinCheckGap) {
        return { ok: true, skipped: true };
    }
    _lastPinCheck = now;

    // WebApp URL
    const base       = WEBAPP_URL ? String(WEBAPP_URL).replace(/\/+$/, "") : "";
    const dashUrl    = base || "https://totli-inky.vercel.app";
    const printUrl   = base ? base + "/print" : null;

    try {
        // ── Bot o'zi haqida ma'lumot ──────────────────────
        const me = await bot.getMe();

        // ── Guruh pinini tekshirish ───────────────────────
        const chat   = await bot.getChat(groupId);
        const pinned = chat?.pinned_message;

        // Pin bor va bizniki — tegmaymiz
        if (!forceSend && pinned) {
            const kb   = (pinned.reply_markup?.inline_keyboard || []).flat();
            const ours = kb.some(b =>
                (b?.web_app?.url && b.web_app.url.startsWith(base || "https://totli")) ||
                (b?.url          && b.url.startsWith(base || "https://totli"))
            );
            if (ours) {
                console.log("✅ [pin] Pin allaqachon to'g'ri — tegmadik");
                return { ok: true, updated: false };
            }
        }

        // Eski pinni yechamiz
        if (pinned?.message_id) {
            await bot.unpinChatMessage(groupId, { message_id: pinned.message_id }).catch(() => {});
        }

        // ── Hisobot xabari matni ──────────────────────────
        const d    = new Date(new Date().toLocaleString("en", { timeZone: "Asia/Tashkent" }));
        const date = `${d.getDate()}-${d.toLocaleString("uz", { month: "short" })}`;

        const text =
            `📊 <b>TOTLI — Kunlik boshqaruv</b>\n` +
            `📅 ${date} | 🍰 Totli tortlar\n\n` +
            `👇 Dashboard ni oching yoki chek stansiyasini ishga tushiring:`;

        // ── Inline tugmalar ──────────────────────────────
        const kb = [[{ text: "📊 Dashboard", web_app: { url: dashUrl } }]];
        if (printUrl) {
            kb.push([{ text: "🖨 Print Station", web_app: { url: printUrl } }]);
        }

        // ── Xabar yuborish ───────────────────────────────
        const sent = await bot.sendMessage(groupId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: kb },
            disable_web_page_preview: true,
        });

        // ── Pin qilish ───────────────────────────────────
        await bot.pinChatMessage(groupId, sent.message_id, {
            disable_notification: true,
        }).then(() => {
            console.log(`📌 [pin] Guruhga pin xabar yuborildi va pin qilindi`);
        }).catch((e) => {
            console.warn(`⚠️ [pin] Pin qilishda xato: ${e?.message}`);
            console.warn("⚠️ [pin] Bot guruhda admin bo'lishi va 'Pin messages' ruxsati bo'lishi kerak");
        });

        return { ok: true, updated: true, messageId: sent.message_id };

    } catch (e) {
        const msg = e?.message || String(e);

        if (msg.includes("chat not found") || msg.includes("400")) {
            console.error(`❌ [pin] Guruh topilmadi: ${groupId}`);
            console.error("❌ [pin] Tekshiring: 1) GROUP_CHAT_ID to'g'rimi? 2) Bot guruhda a'zomi?");
        } else if (msg.includes("403") || msg.includes("Forbidden")) {
            console.error(`❌ [pin] Bot guruhga xabar yubora olmaydi — admin qiling`);
        } else {
            console.error(`❌ [pin] Xato: ${msg}`);
        }

        return { ok: false, error: msg };
    }
}

// ── Kunlik scheduler — har 2 soatda pin tekshirish ───────
function schedulePinChecker(bot) {
    // Dastlabki tekshirish — 10 soniyadan keyin
    setTimeout(() => ensurePinnedMiniAppLinkInGroup(bot).catch(() => {}), 10_000);

    // Har 2 soatda tekshiradi
    setInterval(() => {
        _lastPinCheck = 0; // reset — tekshirishga majburlaydi
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => {});
    }, 2 * 60 * 60 * 1000);

    console.log("📌 [pin] Scheduler: ishga tushdi (har 2 soatda tekshiradi)");
}

module.exports = { ensurePinnedMiniAppLinkInGroup, schedulePinChecker };
