// src/logic/balanceEditFlow.js
// ✅ Faqat ADMIN_TG_ID uchun — balansni to'g'ridan-to'g'ri tahrirlash
const { ADMIN_TG_ID } = require("../config");
const { getBalance, addBalance } = require("./storage");
const { redis } = require("../services/auth");
const { formatMoney } = require("../utils/money");
const { mainMenuKeyboard } = require("../keyboards");

const KEY = (userId) => `bal_edit:${userId}`;

function isAdmin(userId) {
    return !!(ADMIN_TG_ID && Number(userId) === Number(ADMIN_TG_ID));
}

async function showBalanceEdit(bot, chatId, userId) {
    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, "⛔ Ruxsat yo'q.");
        return;
    }

    const balance = await getBalance();
    await redis.set(KEY(userId), "awaiting", "EX", 300);

    await bot.sendMessage(
        chatId,
        `💰 <b>Balansni tahrirlash</b>\n\n` +
        `Joriy balans: <b>${formatMoney(balance)}</b> so'm\n\n` +
        `Qanday son yozing:\n` +
        `• <code>500000</code> — aniq qiymat o'rnatish\n` +
        `• <code>+50000</code> — qo'shish\n` +
        `• <code>-30000</code> — ayirish\n\n` +
        `Bekor qilish: /tozalash`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "+10 000",  callback_data: "bal_quick:+10000" },
                        { text: "+50 000",  callback_data: "bal_quick:+50000" },
                        { text: "+100 000", callback_data: "bal_quick:+100000" },
                    ],
                    [
                        { text: "-10 000",  callback_data: "bal_quick:-10000" },
                        { text: "-50 000",  callback_data: "bal_quick:-50000" },
                        { text: "❌ Bekor", callback_data: "bal_edit_cancel" },
                    ]
                ]
            }
        }
    );
}

async function handleBalanceEditMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text   = String(msg.text || "").trim();

    if (!isAdmin(userId)) return false;

    const state = await redis.get(KEY(userId));
    if (state !== "awaiting") return false;

    // Son formatini tekshirish: +50000, -30000, 500000
    const isRelative = text.startsWith("+") || text.startsWith("-");
    const num = parseInt(text.replace(/[^\d\-\+]/g, ""), 10);

    if (isNaN(num) || num === 0) {
        await bot.sendMessage(
            chatId,
            "❌ Noto'g'ri son. Masalan:\n" +
            "<code>500000</code>  yoki  <code>+50000</code>  yoki  <code>-30000</code>",
            { parse_mode: "HTML" }
        );
        return true;
    }

    return _applyBalanceChange(bot, chatId, userId, num, isRelative);
}

// Tezkor tugmalar uchun (callback_query da chaqiriladi)
async function handleBalanceQuickCallback(bot, q, userId) {
    const data = q.data || "";
    if (!data.startsWith("bal_quick:")) return false;
    if (!isAdmin(userId)) {
        await bot.answerCallbackQuery(q.id, { text: "⛔ Ruxsat yo'q" });
        return true;
    }

    const val = data.split(":")[1]; // "+50000" yoki "-10000"
    const num = parseInt(val, 10);
    if (!num) return false;

    try { await bot.answerCallbackQuery(q.id); } catch {}

    await _applyBalanceChange(bot, q.message.chat.id, userId, num, true);
    return true;
}

async function _applyBalanceChange(bot, chatId, userId, num, isRelative) {
    const oldBalance = await getBalance();
    const delta = isRelative ? num : num - oldBalance;
    const newBalance = oldBalance + delta;

    if (newBalance < 0) {
        await bot.sendMessage(
            chatId,
            `❌ <b>Balans manfiy bo'lib ketadi!</b>\n\n` +
            `Joriy: <b>${formatMoney(oldBalance)}</b> so'm\n` +
            `Delta: <b>${delta >= 0 ? "+" : ""}${formatMoney(delta)}</b> so'm\n` +
            `Natija: <b>${formatMoney(newBalance)}</b> so'm`,
            { parse_mode: "HTML" }
        );
        return true;
    }

    await addBalance(delta);
    await redis.del(KEY(userId));

    const sign = delta >= 0 ? "+" : "";
    await bot.sendMessage(
        chatId,
        `✅ <b>Balans yangilandi!</b>\n\n` +
        `📌 Avval: <b>${formatMoney(oldBalance)}</b> so'm\n` +
        `📌 O'zgarish: <b>${sign}${formatMoney(Math.abs(delta))}</b> so'm\n` +
        `💰 <b>Yangi balans: ${formatMoney(newBalance)}</b> so'm`,
        { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
    );
    return true;
}

module.exports = { isAdmin, showBalanceEdit, handleBalanceEditMessage, handleBalanceQuickCallback };
