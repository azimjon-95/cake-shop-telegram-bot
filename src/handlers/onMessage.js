// src/handlers/onMessage.js (FINAL NEW VERSION + CHANGE SMS + WEBAPP ORDER)
const dayjs = require("dayjs");

const { GROUP_CHAT_ID, CUSTOMER_BOT_USERNAME, MIN_QR_PAID } = require("../config");
const { mainMenuKeyboard, startKeyboard, monthKeyboard } = require("../keyboards");
const { isAuthed, setAuthed, setMode, getMode, checkPassword, redis } = require("../services/auth");
const { startCashbackFlow, handleCashbackMessage } = require("../logic/cashbackFlow");
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
const { createReceiptTokenIfNeeded } = require("../services/receipt");
const {
    getUserName,
    itemsToText,
    deleteSaleKeyboard,
    formatDebtCard,
    printReceiptButton,
    mergeKeyboardsAbove,
    debtPayButton
} = require("../logic/ui");

// ✅ Expense category flow
const { startExpense, onExpenseMessage } = require("./expenseFlow");

// ✅ Purchase + Supplier flow
const { startPurchase, onPurchaseMessage } = require("./purchaseFlow");

// =========================
// ✅ Helpers (HTML safe)
// =========================
function escHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function normalizePhone(raw) {
    let p = String(raw ?? "").replace(/[^\d]/g, "");
    if (!p) return "";
    if (p.length === 9) p = "998" + p;
    return p;
}

// =========================
// ✅ WebApp Order Handler
// msg.web_app_data.data -> JSON
// { cake, price, name, phone, img }
// =========================
async function handleWebAppOrder(bot, msg) {
    const wad = msg?.web_app_data?.data;
    if (!wad) return false;

    let data;
    try {
        data = JSON.parse(wad);
    } catch (e) {
        await bot.sendMessage(msg.chat.id, "❌ WebApp data xato (JSON parse bo‘lmadi).");
        return true;
    }

    const user = msg.from || {};
    const fromName =
        [user.first_name, user.last_name].filter(Boolean).join(" ") ||
        "—";
    const username = user.username ? `@${user.username}` : "—";

    const cake = escHtml(data.cake || "—");
    const price = escHtml(data.price || "—");
    const clientName = escHtml(data.name || "—");
    const phone = escHtml(normalizePhone(data.phone) || "—");

    const text =
        `🧁 <b>Yangi zakaz!</b>\n\n` +
        `🍰 <b>Tort:</b> ${cake}\n` +
        `💵 <b>Narx:</b> ${price}\n` +
        `👤 <b>Mijoz:</b> ${clientName}\n` +
        `📞 <b>Tel:</b> <code>${phone}</code>\n\n` +
        `🙋‍♂️ <b>Telegram:</b> ${escHtml(fromName)} (${escHtml(username)})\n` +
        `🆔 <b>TG ID:</b> <code>${user.id || "—"}</code>`;

    const target = GROUP_CHAT_ID || msg.chat.id;

    // Rasm bilan yuborish
    try {
        if (data.img) {
            await bot.sendPhoto(target, data.img, { caption: text, parse_mode: "HTML" });
        } else {
            await bot.sendMessage(target, text, { parse_mode: "HTML" });
        }
    } catch (e) {
        // Photo xato bo'lsa fallback
        await bot.sendMessage(target, text, { parse_mode: "HTML" });
    }

    // Mijozga tasdiq
    await bot.sendMessage(
        msg.chat.id,
        "✅ Zakazingiz qabul qilindi! Tez orada aloqaga chiqamiz. 🙌"
    );

    return true;
}

async function onMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    // ✅ WebApp order msg.text bo'lmasligi mumkin — shuning uchun eng boshida ushlaymiz
    const webappHandled = await handleWebAppOrder(bot, msg);
    if (webappHandled) return;

    const text = String(msg.text || "").trim();
    if (!userId || !text) return;

    // =========================================
    // ✅ COMMANDS (ENG TEPADA TURISHI SHART)
    // =========================================

    // /tozalash — hamma jarayonlarni bekor qilish + menyu
    if (text === "/tozalash") {
        await Promise.all([
            redis.del(`await_pay_amount:${userId}`),
            redis.del(`await_del:${userId}`),
            redis.del(`pur_state:${userId}`),
            redis.del(`exp_state:${userId}`),

            // ✅ yangi: cashback flow
            redis.del(`await_cashback:${userId}`),
        ]);

        await setMode(userId, "menu");
        return bot.sendMessage(
            chatId,
            "🧹 Bekor qilindi (otmena). Menyu:",
            { reply_markup: mainMenuKeyboard() }
        );
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

    // 1) agar cashback flow davom etayotgan bo‘lsa
    const cb = await handleCashbackMessage(bot, chatId, userId, msg.text);
    if (cb.handled) return;

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
    if (text === "🎁 Kashback orqali xarid") {
        await startCashbackFlow(bot, chatId, userId);
        return;
    }

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

        const receiptToken = await createReceiptTokenIfNeeded({ sale, minPaid: MIN_QR_PAID });

        // if (receiptToken && CUSTOMER_BOT_USERNAME) {
        //     const deepLink = `https://t.me/${CUSTOMER_BOT_USERNAME}?start=${receiptToken.token}`;

        //     await bot.sendMessage(
        //         chatId,
        //         `🎁 <b>Bonus olish</b>\n` +
        //         `🧾 Chek: <code>${sale.orderNo}</code>\n` +
        //         `✅ Shart: <b>${formatMoney(MIN_QR_PAID)}</b> so'm va undan yuqori\n\n` +
        //         `👇 Bonus olish uchun link:\n${deepLink}\n\n` +
        //         `📌 Eslatma: Chek <b>1 marta</b> ishlaydi (odno-razoviy).`,
        //         { parse_mode: "HTML" }
        //     );
        // }

        let webappUrl = null;
        if (receiptToken?.token && process.env.WEBAPP_URL) {
            webappUrl = `${process.env.WEBAPP_URL}/receipt?token=${receiptToken.token}`;
        }

        const delKbd = deleteSaleKeyboard(sale._id);
        const mergedKbd = webappUrl
            ? mergeKeyboardsAbove(delKbd, printReceiptButton(webappUrl))
            : delKbd;

        await bot.sendMessage(
            chatId,
            `✅ <b>Sotuv saqlandi</b>\n🆔 ID: <code>${sale.orderNo}</code>\n` +
            `Tushgan: <b>${formatMoney(sale.paidTotal)}</b> so'm` +
            (sale.debtTotal > 0 ? `\nQarz: <b>${formatMoney(sale.debtTotal)}</b> so'm` : ""),
            { parse_mode: "HTML", ...mergedKbd }
        );

        await sendToGroup(bot, notify);

        if (debtDoc) {
            await bot.sendMessage(
                chatId,
                `📌 Qarz yaratildi: <b>${formatMoney(debtDoc.remainingDebt)}</b> so'm`,
                { parse_mode: "HTML" }
            );
        }

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