// src/handlers/onMessage.js (FINAL NEW VERSION + CHANGE SMS)
const dayjs = require("dayjs");

const { GROUP_CHAT_ID } = require("../config");
const { mainMenuKeyboard, startKeyboard, monthKeyboard } = require("../keyboards");
const { isAuthed, setAuthed, setMode, getMode, checkPassword, redis } = require("../services/auth");

const Debt = require("../models/Debt");

const { closeCashAndMakeReport } = require("../services/closeCash");
const { sendToGroup } = require("../services/notify");
const { closeNotifyText, saleNotifyText, debtPayNotifyText } = require("../utils/report");
const { payDebt } = require("../services/debtPay");
const { parseSaleMessage } = require("../utils/parseSale");
const { formatMoney } = require("../utils/money");

const { helpText } = require("../utils/helpText");
const { saveSaleWithTx } = require("../logic/storage");
const { handleDeleteMessage } = require("../logic/deleteFlow");
const {
    getUserName,
    itemsToText,
    deleteSaleKeyboard,
    formatDebtCard,
    debtPayButton
} = require("../logic/ui");

// ✅ Expense category flow
const { startExpense, onExpenseMessage } = require("./expenseFlow");

// ✅ Purchase + Supplier flow
const { startPurchase, onPurchaseMessage } = require("./purchaseFlow");

async function onMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();
    if (!userId || !text) return;

    // =========================================
    // ✅ COMMANDS (ENG TEPADA TURISHI SHART)
    // =========================================

    // /tozalash — hamma jarayonlarni bekor qilish + menyu
    if (text === "/tozalash") {
        await redis.del(`await_pay_amount:${userId}`);
        await redis.del(`await_del:${userId}`);
        await redis.del(`pur_state:${userId}`);
        await redis.del(`exp_state:${userId}`);

        await setMode(userId, "menu");
        return bot.sendMessage(chatId, "🧹 Tozalandi. Menyu:", { reply_markup: mainMenuKeyboard() });
    }

    // /start — autent bo'lsa menyu, bo'lmasa parol
    if (text === "/start") {
        const ok = await isAuthed(userId);
        if (ok) {
            await setMode(userId, "menu");
            return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
        }
        await setMode(userId, "await_password");
        return bot.sendMessage(chatId, "🔑 Parolni kiriting:");
    }

    // Shundan keyin boshqa "/" komandalarni bekor qilamiz
    if (text.startsWith("/")) return;

    // =========================================
    // 1) DELETE FLOW
    // =========================================
    const delHandled = await handleDeleteMessage(bot, chatId, userId, text);
    if (delHandled.handled) return;

    // =========================================
    // 2) START BUTTON
    // =========================================
    if (text === "▶️ Start") {
        const ok = await isAuthed(userId);
        if (ok) return bot.sendMessage(chatId, "✅ Siz allaqachon kirdingiz.", { reply_markup: mainMenuKeyboard() });

        await bot.sendMessage(chatId, "🔑 Parolni kiriting:");
        await setMode(userId, "await_password");
        return;
    }

    const mode = await getMode(userId);

    // =========================================
    // 3) PASSWORD
    // =========================================
    if (mode === "await_password") {
        if (checkPassword(text)) {
            await setAuthed(userId);
            await setMode(userId, "menu");
            return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
        }
        return bot.sendMessage(chatId, "❌ Noto‘g‘ri parol. Qayta kiriting:");
    }

    // =========================================
    // 4) AUTH CHECK
    // =========================================
    const ok = await isAuthed(userId);
    if (!ok) return bot.sendMessage(chatId, "🔒 Avval /start bosing va parol kiriting.", startKeyboard());

    // =========================================
    // 5) PAY PART INPUT
    // =========================================
    const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
    if (awaitingDebtId) {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (!amount) return bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 30000");

        const payer = { tgId: userId, tgName: getUserName(msg) };

        const debt = await Debt.findById(awaitingDebtId);
        if (!debt) {
            await redis.del(`await_pay_amount:${userId}`);
            return bot.sendMessage(chatId, "❌ Qarz topilmadi.");
        }

        const { debt: updated, actualPay } = await payDebt({ debtId: awaitingDebtId, amount, payer });
        await redis.del(`await_pay_amount:${userId}`);

        let phone = debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null;
        if (phone && phone.length === 9) phone = "998" + phone;

        const notify = debtPayNotifyText({
            payerName: payer.tgName,
            note: debt.note || "-",
            phone,
            paid: actualPay,
            remaining: updated.remainingDebt
        });

        await bot.sendMessage(
            chatId,
            `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
            { parse_mode: "HTML" }
        );
        await sendToGroup(bot, notify);
        return;
    }

    // =========================================
    // ✅ NEW FLOWS (ENG OLDIN ISHLASIN)
    // =========================================
    const purchaseHandled = await onPurchaseMessage(bot, msg);
    if (purchaseHandled) return;

    const expenseHandled = await onExpenseMessage(bot, msg);
    if (expenseHandled) return;

    // =========================================
    // 6) MENU BUTTONS
    // =========================================
    if (text === "🧁 Sotish") {
        await setMode(userId, "sale");
        return bot.sendMessage(
            chatId,
            "🧁 Sotish rejimi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000\nYoki: Tort 100000 80000 tel 903456677"
        );
    }

    if (text === "💸 Chiqim") {
        return startExpense(bot, chatId, userId);
    }

    if (text === "📦 Kirim (Taminot)") {
        return startPurchase(bot, chatId, userId);
    }

    if (text === "📌 Qarzlar") {
        const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(50);
        if (debts.length === 0) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo‘q.");

        await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
        for (const d of debts) {
            await bot.sendMessage(chatId, formatDebtCard(d), { parse_mode: "HTML", ...debtPayButton(d._id) });
        }
        return;
    }

    if (text === "📆 Oylik hisobot") {
        const year = dayjs().year();
        return bot.sendMessage(chatId, `📆 Oylik hisobot.\nOyni tanlang (${year}):`, { reply_markup: monthKeyboard(year) });
    }

    if (text === "🔒 Kasani yopish") {
        const summary = await closeCashAndMakeReport();
        const msgText = closeNotifyText(summary);

        await bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
        await sendToGroup(bot, msgText);

        await bot.sendDocument(chatId, summary.filePath, {}, { filename: summary.fileName });
        if (GROUP_CHAT_ID) await bot.sendDocument(GROUP_CHAT_ID, summary.filePath, {}, { filename: summary.fileName });
        return;
    }

    if (text === "ℹ️ Yordam") {
        return bot.sendMessage(chatId, helpText(), { parse_mode: "HTML" });
    }

    // =========================================
    // SALE
    // =========================================
    const seller = { tgId: userId, tgName: getUserName(msg) };
    const currentMode = mode === "menu" || !mode ? null : mode;
    const hasMoney = /\d/.test(text);

    if (currentMode === "sale" || hasMoney) {
        const parsed = parseSaleMessage(text);
        if (!parsed.items.length) {
            return bot.sendMessage(chatId, "❌ Sotuv topilmadi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000");
        }

        const itemsText = itemsToText(parsed.items);

        // ✅ NEW: change ham qaytadi
        const { sale, debtDoc, change } = await saveSaleWithTx({
            seller,
            items: parsed.items,
            phone: parsed.phone,
            noteText: itemsText
        });

        const notify = saleNotifyText({
            sellerName: seller.tgName,
            itemsText,
            paidTotal: sale.paidTotal,
            debtTotal: sale.debtTotal,
            phone: sale.phone
        });

        await bot.sendMessage(
            chatId,
            `✅ <b>Sotuv saqlandi</b>\n🆔 ID: <code>${sale.orderNo}</code>\n` +
            `Tushgan: <b>${formatMoney(sale.paidTotal)}</b> so'm` +
            (sale.debtTotal > 0 ? `\nQarz: <b>${formatMoney(sale.debtTotal)}</b> so'm` : ""),
            { parse_mode: "HTML", ...deleteSaleKeyboard(sale._id) }
        );

        await sendToGroup(bot, notify);

        if (debtDoc) {
            await bot.sendMessage(
                chatId,
                `📌 Qarz yaratildi: <b>${formatMoney(debtDoc.remainingDebt)}</b> so'm`,
                { parse_mode: "HTML" }
            );
        }

        // ✅ NEW: QAYTIM (DB ga saqlanmaydi, faqat sms)
        if (change && change > 0) {
            await bot.sendMessage(
                chatId,
                `💵 Qaytim: <b>${formatMoney(change)}</b> so'm\n⚠️ Mijozga <b>${formatMoney(change)}</b> so'm qaytarib bering.`,
                { parse_mode: "HTML" }
            );
        }

        return;
    }

    return bot.sendMessage(chatId, "ℹ️ Menyu tugmalaridan birini tanlang yoki Yordam’ni bosing.", {
        reply_markup: mainMenuKeyboard()
    });
}

module.exports = { onMessage };
