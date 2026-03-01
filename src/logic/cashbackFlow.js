// src/logic/cashbackFlow.js
const Customer = require("../models/Customer");
const { redis } = require("../services/auth");
const { sendToGroup } = require("../services/notify");
const { escapeHtml } = require("./ui");
const { formatMoney } = require("../utils/money");
function key(userId) {
    return `await_cashback:${userId}`;
}

function onlyDigits(s) {
    return String(s || "").replace(/[^\d]/g, "");
}

function toInt(s) {
    const n = parseInt(onlyDigits(s), 10);
    return Number.isFinite(n) ? n : 0;
}

async function startCashbackFlow(bot, chatId, userId) {
    await redis.set(key(userId), JSON.stringify({ step: "tgid" }), "EX", 300);
    await bot.sendMessage(
        chatId,
        "🎁 <b>Kashback orqali xarid</b>\n\nMijozning <b>TelegramID</b> sini yozing (faqat raqam):",
        { parse_mode: "HTML" }
    );
}

async function handleCashbackMessage(bot, chatId, userId, text) {
    const raw = await redis.get(key(userId));
    if (!raw) return { handled: false };

    let st;
    try { st = JSON.parse(raw); } catch { st = null; }
    if (!st) {
        await redis.del(key(userId));
        await bot.sendMessage(chatId, "⚠️ Holat buzildi. Qaytadan boshlang.");
        return { handled: true };
    }

    // 1) tgId
    if (st.step === "tgid") {
        const tgId = toInt(text);
        if (!tgId) {
            await bot.sendMessage(chatId, "❌ Telegram ID noto‘g‘ri. Faqat raqam yuboring.");
            return { handled: true };
        }

        const customer = await Customer.findOne({ tgId }).lean();
        if (!customer) {
            await bot.sendMessage(chatId, "❌ Bu tgId bo‘yicha mijoz topilmadi.");
            return { handled: true };
        }

        st.step = "amount";
        st.tgId = tgId;
        st.customerName = customer.tgName || "";
        st.points = Number(customer.points || 0);

        await redis.set(key(userId), JSON.stringify(st), "EX", 300);

        await bot.sendMessage(
            chatId,
            `👤 Mijoz: <b>${escapeHtml(st.customerName || String(tgId))}</b>\n` +
            `🆔 tgId: <code>${tgId}</code>\n` +
            `⭐️ Kashback: <b>${formatMoney(Math.floor(st.points))} so'm</b>\n\n` +
            `Qancha cashback yechamiz? (0..${formatMoney(Math.floor(st.points))}) so'm`,
            { parse_mode: "HTML" }
        );
        return { handled: true };
    }

    // 2) amount
    if (st.step === "amount") {
        const amount = toInt(text);
        if (!amount || amount <= 0) {
            await bot.sendMessage(chatId, "❌ Summani to‘g‘ri kiriting (masalan: 5000).");
            return { handled: true };
        }
        if (amount > Number(st.points || 0)) {
            await bot.sendMessage(chatId, `❌ Yetarli cashback yo‘q. Maks: ${st.points}`);
            return { handled: true };
        }

        st.step = "what";
        st.amount = amount;
        await redis.set(key(userId), JSON.stringify(st), "EX", 300);

        await bot.sendMessage(chatId, "🛍 Nima sotib oldi? (matn yozing, masalan: 'Tort Rafaelo 1ta')");
        return { handled: true };
    }

    // 3) what
    if (st.step === "what") {
        const what = String(text || "").trim();
        if (what.length < 2) {
            await bot.sendMessage(chatId, "❌ Nima olganini yozing (kamida 2 belgi).");
            return { handled: true };
        }

        // ✅ DB update (BALANS GA TEGMAYDI!)
        const tgId = st.tgId;
        const amount = Number(st.amount || 0);

        const updated = await Customer.findOneAndUpdate(
            { tgId, points: { $gte: amount } },     // ✅ minusga tushmasin
            { $inc: { points: -amount }, $set: { updatedAt: new Date() } },
            { new: true }
        ).lean();

        await redis.del(key(userId));

        if (!updated) {
            await bot.sendMessage(chatId, "❌ Cashback yechishda xatolik (balans yetmasligi mumkin). Qayta urinib ko‘ring.");
            return { handled: true };
        }

        await bot.sendMessage(
            chatId,
            `✅ Kashback orqali xarid yakunlandi.\n` +
            `👤 Mijoz: ${updated.tgName || tgId}\n` +
            `➖ Yechildi: ${formatMoney(amount)} so'm\n` +
            `⭐️ Qoldi: ${formatMoney(updated.points)} so'm`
        );

        // ✅ groupga xabar
        await sendToGroup(
            bot,
            `🎁 <b>KASHBACK ORQALI XARID</b>\n\n` +
            `👤 Mijoz: <b>${escapeHtml(updated.tgName || "-")}</b>\n` +
            `🆔 tgId: <code>${tgId}</code>\n` +
            `🛍 Nima: <b>${escapeHtml(what)}</b>\n` +
            `➖ Yechildi: <b>${formatMoney(amount)} so'm</b>\n` +
            `⭐️ Qoldi: <b>${formatMoney(updated.points)} so'm</b>`,
            { parse_mode: "HTML" }
        );

        return { handled: true };
    }

    return { handled: false };
}

module.exports = { startCashbackFlow, handleCashbackMessage };