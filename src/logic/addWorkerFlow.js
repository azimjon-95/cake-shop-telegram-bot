// src/logic/addWorkerFlow.js
// ✅ Foydalanuvchi qo'shish — 3 usul: Contact share, Forward, TgId yozish
const Worker = require("../models/Worker");
const { usersKeyboard, addWorkerKeyboard } = require("../keyboards");
const { escapeHtml } = require("./ui");
const { setMode } = require("../services/auth");

// ──────────────────────────────────────────
// 1) CONTACT SHARE orqali
// ──────────────────────────────────────────
async function handleSharedContact(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const contact = msg.contact;

    // Telegram contact bo'lmasa (oddiy telefon kitob kontakti)
    if (!contact?.user_id) {
        await bot.sendMessage(
            chatId,
            "❌ <b>Bu oddiy telefon kontakti</b>\n\n" +
            "Telegram foydalanuvchisini qo'shish uchun:\n" +
            "• Kontaktlar → o'sha odamni toping\n" +
            "• Telegram kontakti sifatida ulashing\n\n" +
            "Yoki u odamning <b>Telegram ID</b> raqamini yozing\n" +
            "(ID bilish uchun: @userinfobot)",
            { parse_mode: "HTML", reply_markup: addWorkerKeyboard() }
        );
        return true;
    }

    const tgId = Number(contact.user_id);
    const fullName = [contact.first_name, contact.last_name]
        .filter(Boolean).join(" ").trim()
        || contact.phone_number
        || `ID:${tgId}`;

    const w = await Worker.findOneAndUpdate(
        { tgId },
        {
            $set: {
                fullName,
                isActive: true,
                canUseWebApp: true,
            },
            $setOnInsert: { role: "worker", username: "" }
        },
        { upsert: true, new: true }
    );

    // Rejimni tozalash
    if (userId) await setMode(userId, "sale");

    await bot.sendMessage(
        chatId,
        `✅ <b>Qo'shildi!</b>\n\n` +
        `👤 Ism: <b>${escapeHtml(fullName)}</b>\n` +
        `🆔 TG ID: <code>${tgId}</code>\n` +
        `📞 Tel: ${contact.phone_number || "—"}\n\n` +
        `Endi u botga /start bosib kira oladi.`,
        { parse_mode: "HTML", reply_markup: usersKeyboard() }
    );
    return true;
}

// ──────────────────────────────────────────
// 2) TG ID RAQAMI YOZISH ORQALI
// ──────────────────────────────────────────
async function handleTgIdWorkerAdd(bot, chatId, userId, text) {
    const cleaned = String(text || "").replace(/[^\d]/g, "");

    // 5–12 ta raqam bo'lishi kerak
    if (cleaned.length < 5 || cleaned.length > 12) return false;

    const tgId = Number(cleaned);
    if (!tgId || isNaN(tgId)) return false;

    const existing = await Worker.findOne({ tgId });
    if (existing) {
        await bot.sendMessage(
            chatId,
            `ℹ️ Bu foydalanuvchi allaqachon mavjud:\n\n` +
            `👤 <b>${escapeHtml(existing.fullName || "Noma'lum")}</b>\n` +
            `🆔 <code>${tgId}</code>\n` +
            `${existing.isActive ? "🟢 Aktiv" : "🔴 Nofaol"}`,
            { parse_mode: "HTML", reply_markup: usersKeyboard() }
        );
        if (userId) await setMode(userId, "sale");
        return true;
    }

    await Worker.create({
        tgId,
        fullName: `ID:${tgId}`,
        username: "",
        isActive: true,
        canUseWebApp: true,
        role: "worker"
    });

    if (userId) await setMode(userId, "sale");

    await bot.sendMessage(
        chatId,
        `✅ <b>Qo'shildi!</b>\n\n` +
        `🆔 TG ID: <code>${tgId}</code>\n\n` +
        `Ism keyinroq bot ichida avtomatik yangilanadi.\n` +
        `Endi u botga /start bosib kira oladi.`,
        { parse_mode: "HTML", reply_markup: usersKeyboard() }
    );
    return true;
}

// ──────────────────────────────────────────
// 3) FORWARD ORQALI
// ──────────────────────────────────────────
async function handleForwardedUser(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const fwdUser = msg.forward_from;

    if (!fwdUser?.id) {
        await bot.sendMessage(
            chatId,
            "⚠️ <b>Forward xabardan foydalanuvchi aniqlanmadi</b>\n\n" +
            "Bu odamning <b>Maxfiylik sozlamalari → Forwarded Messages</b> yopiq bo'lishi mumkin.\n\n" +
            "✅ Iltimos:\n" +
            "• <b>Kontakt ulashing</b> tugmasini ishlating\n" +
            "• Yoki TG ID raqamini yozing (@userinfobot orqali bilib oling)",
            { parse_mode: "HTML", reply_markup: addWorkerKeyboard() }
        );
        return false;
    }

    const tgId = Number(fwdUser.id);
    const fullName = [fwdUser.first_name, fwdUser.last_name]
        .filter(Boolean).join(" ").trim()
        || fwdUser.username
        || `ID:${tgId}`;

    await Worker.findOneAndUpdate(
        { tgId },
        {
            $set: {
                fullName,
                username: fwdUser.username || "",
                isActive: true,
                canUseWebApp: true,
            },
            $setOnInsert: { role: "worker" }
        },
        { upsert: true, new: true }
    );

    if (userId) await setMode(userId, "sale");

    await bot.sendMessage(
        chatId,
        `✅ <b>Forward orqali qo'shildi!</b>\n\n` +
        `👤 Ism: <b>${escapeHtml(fullName)}</b>\n` +
        `🆔 TG ID: <code>${tgId}</code>`,
        { parse_mode: "HTML", reply_markup: usersKeyboard() }
    );
    return true;
}

module.exports = { handleSharedContact, handleForwardedUser, handleTgIdWorkerAdd };
