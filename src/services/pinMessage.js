// src/services/pinMessage.js
// Guruhga pin xabar: Hisobotlar + har filial uchun Print Station tugmasi.
// Filiallar bitta guruhni bo'lishsa — bitta xabar, har filial uchun alohida Print tugmasi.
// Guruhda web_app tugmasi ishlamaydi (faqat private chatda), shuning uchun oddiy url tugmalar.

const { WEBAPP_URL } = require("../config");
const { branchIds, getBranch, groupFor } = require("./branches");

let _lastPinCheck = 0;
const _sentMessageIds = new Map(); // groupId -> oxirgi yuborilgan xabar ID

// groupId -> [branchId, ...]
function groupsMap() {
    const map = new Map();
    for (const id of branchIds()) {
        const g = groupFor(id);
        if (!g) continue;
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(id);
    }
    return map;
}

async function pinInGroup(bot, groupId, branches, forceSend, botUsername) {
    const base = (WEBAPP_URL || "https://totli-inky.vercel.app").replace(/\/+$/, "");

    try {
        // ── Eski pinimiz hali turibdimi (restartdan keyin ham aniqlaydi) ──
        if (!forceSend) {
            try {
                const chat   = await bot.getChat(groupId);
                const pinned = chat?.pinned_message;
                const btns   = (pinned?.reply_markup?.inline_keyboard || []).flat();
                const printCount = btns.filter(b => String(b?.url || "").includes("/print?branch=")).length;
                const ours = pinned?.message_id === _sentMessageIds.get(groupId) || printCount === branches.length;
                if (pinned && ours) {
                    console.log(`✅ [pin] ${groupId}: pin hali turibdi — tegmadik`);
                    return { ok: true, updated: false };
                }
            } catch { }
        }

        const text = `📈 <b>TOTLI boshqaruv paneliga kirish</b>\n`;

        const inline_keyboard = [
            [{ text: "📊 Hisobotlar", url: `https://t.me/${botUsername}?startapp` }],
        ];
        for (const id of branches) {
            inline_keyboard.push([{
                text: `🖨 Print Station — ${getBranch(id).short}`,
                url: `${base}/print?branch=${id}`,
            }]);
        }

        const sent = await bot.sendMessage(groupId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard },
            disable_web_page_preview: true,
        });

        _sentMessageIds.set(groupId, sent.message_id);
        console.log(`📤 [pin] ${groupId}: xabar yuborildi ${sent.message_id}`);

        // ── Pin qilish ───────────────────────────────────
        try {
            await bot.pinChatMessage(groupId, sent.message_id, { disable_notification: true });
            console.log(`📌 [pin] ${groupId}: pin qilindi ✅`);
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

async function ensurePinnedMiniAppLinkInGroup(bot, forceSend = false) {
    const groups = groupsMap();
    if (!groups.size) {
        console.warn("⚠️ [pin] GROUP_CHAT_ID yo'q yoki bo'sh");
        return { ok: false };
    }

    // Throttle — forceSend bo'lmasa 1 soatda 1 marta
    const now = Date.now();
    if (!forceSend && now - _lastPinCheck < 3600_000) {
        return { ok: true, skipped: true };
    }
    _lastPinCheck = now;

    let botUsername = "totlisang_bot";
    try { botUsername = (await bot.getMe())?.username || botUsername; } catch { }

    const results = [];
    for (const [groupId, branches] of groups) {
        results.push(await pinInGroup(bot, groupId, branches, forceSend, botUsername));
    }
    return { ok: results.some(r => r.ok), results };
}

function schedulePinChecker(bot) {
    // Bot ishga tushgandan 15 soniya keyin
    setTimeout(() => ensurePinnedMiniAppLinkInGroup(bot).catch(() => { }), 15_000);

    // Har 2 soatda tekshiradi
    setInterval(() => {
        _lastPinCheck = 0;
        ensurePinnedMiniAppLinkInGroup(bot).catch(() => { });
    }, 2 * 60 * 60 * 1000);

    console.log("📌 [pin] Scheduler ishga tushdi — har 2 soatda tekshiradi");
}

module.exports = { ensurePinnedMiniAppLinkInGroup, schedulePinChecker };
