// src/handlers/onCallback.js  (FINAL + REPORT FILTERS + SAFE EDIT)
const { GROUP_CHAT_ID } = require("../config");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");

const { makeMonthlyReport } = require("../services/monthlyReport");
const { payDebt } = require("../services/debtPay");
const { sendToGroup } = require("../services/notify");
const { debtPayNotifyText } = require("../utils/report");
const { redis } = require("../services/auth");

const { formatMoney } = require("../utils/money");
const { getUserName, escapeHtml, payAmountKeyboard } = require("../logic/ui");
const { startDeleteFlow } = require("../logic/deleteFlow");

// ✅ flows
const { onExpenseCallback } = require("./expenseFlow");
const { onPurchaseCallback } = require("./purchaseFlow");

// ✅ NEW: report filters keyboard + categories
const { reportFiltersKeyboard } = require("../keyboards");
const { EXPENSE_CATEGORIES } = require("../utils/expenseCategories");

// ===================== HELPERS =====================
function getSeller(from) {
    return { tgId: from.id, tgName: getUserName({ from }) };
}

async function safeAnswer(bot, q, text) {
    try {
        if (text) return await bot.answerCallbackQuery(q.id, { text });
        return await bot.answerCallbackQuery(q.id);
    } catch {
        // ignore
    }
}

function normalizePhone(phone) {
    if (!phone) return null;
    let p = String(phone).replace(/[^\d]/g, "");
    if (p.length === 9) p = "998" + p;
    return p || null;
}

// ✅ SAFE edit (message is not modified bo'lsa error chiqarmaydi)
async function editMsgSafe(bot, q, text, reply_markup) {
    try {
        return await bot.editMessageText(text, {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
            parse_mode: "HTML",
            reply_markup
        });
    } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("message is not modified")) return null; // ✅ jim
        throw e;
    }
}

// ===================== REPORT FILTER STATE =====================
const REP_KEY = (userId, y, m) => `rep_filter:${userId}:${y}:${m}`;

function allExpenseKeys() {
    return EXPENSE_CATEGORIES.map(x => x.key);
}

async function getSelectedExpenseKeys(userId, year, monthIndex) {
    const raw = await redis.get(REP_KEY(userId, year, monthIndex));
    if (!raw) return allExpenseKeys(); // ✅ default ALL
    try {
        const arr = JSON.parse(raw);
        // ✅ [] ham bo'lishi mumkin (Clear = none qilmoqchi bo'lsangiz)
        if (Array.isArray(arr)) return arr.length ? arr : allExpenseKeys();
        return allExpenseKeys();
    } catch {
        return allExpenseKeys();
    }
}

async function setSelectedExpenseKeys(userId, year, monthIndex, keys) {
    const arr = Array.isArray(keys) ? keys : allExpenseKeys();
    await redis.set(REP_KEY(userId, year, monthIndex), JSON.stringify(arr), "EX", 60 * 60);
}

// ===================== DEBT (CUSTOMER) =====================
async function handleDebtPayAsk(bot, q, chatId) {
    const debtId = q.data.split(":")[1];
    const debt = await Debt.findById(debtId);

    if (!debt) {
        await safeAnswer(bot, q, "Qarz topilmadi");
        return true;
    }

    if (debt.kind && debt.kind !== "customer") {
        await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
        return true;
    }

    await bot.sendMessage(
        chatId,
        `📌 Qarz: <b>${escapeHtml(debt.note || "-")}</b>\n` +
        `Qolgan: <b>${formatMoney(debt.remainingDebt)}</b> so'm\n` +
        `Qanday to'laysiz?`,
        { parse_mode: "HTML", ...payAmountKeyboard(debtId) }
    );

    return true;
}

async function handleDebtPayFull(bot, q, chatId, seller) {
    const debtId = q.data.split(":")[1];
    const debt = await Debt.findById(debtId);

    if (!debt) {
        await safeAnswer(bot, q, "Qarz topilmadi");
        return true;
    }

    if (debt.kind && debt.kind !== "customer") {
        await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
        return true;
    }

    const { debt: updated, actualPay } = await payDebt({
        debtId,
        amount: debt.remainingDebt,
        payer: seller
    });

    const notify = debtPayNotifyText({
        payerName: seller.tgName,
        note: escapeHtml(debt.note || "-"),
        phone: normalizePhone(debt.customerPhone),
        paid: actualPay,
        remaining: updated.remainingDebt
    });

    await bot.sendMessage(
        chatId,
        `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\n` +
        `Qolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
        { parse_mode: "HTML" }
    );

    await sendToGroup(bot, notify);
    return true;
}

async function handleDebtPayPart(bot, q, chatId, fromId) {
    const debtId = q.data.split(":")[1];

    const debt = await Debt.findById(debtId);
    if (!debt) {
        await safeAnswer(bot, q, "Qarz topilmadi");
        return true;
    }

    if (debt.kind && debt.kind !== "customer") {
        await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
        return true;
    }

    await redis.set(`await_pay_amount:${fromId}`, debtId, "EX", 300);
    await bot.sendMessage(chatId, "✍️ Qancha to'laysiz? (faqat summa yozing, masalan: 30000)");
    return true;
}

// ===================== MONTH REPORT (EDIT + FILTERS) =====================
async function editReportMessage(bot, q, rep, year, monthIndex, selectedKeys) {
    const textMsg =
        `📆 <b>Oylik hisobot: ${rep.monthTitle}</b>\n\n` +
        `📦 Kirim (maxsulot keldi): <b>${formatMoney(rep.purchaseSum)}</b> so'm\n` +
        `🧁 Sotildi (jami savdo): <b>${formatMoney(rep.soldTotal)}</b> so'm\n` +
        `💰 Sotuvdan tushgan: <b>${formatMoney(rep.paidSum)}</b> so'm\n` +
        `💸 Chiqimlar: <b>${formatMoney(rep.expenseSum)}</b> so'm\n\n` +
        `👥 Bizdan qarz (mijozlar): <b>${formatMoney(rep.customerDebtSum)}</b> so'm\n` +
        `🏭 Bizning qarz (firmalar): <b>${formatMoney(rep.supplierDebtSum)}</b> so'm\n` +
        `🏦 Kassa balansi: <b>${formatMoney(rep.balance)}</b> so'm\n\n` +
        `🎛 Filter (Chiqim): <b>${(selectedKeys?.length ? selectedKeys.join(", ") : "ALL")}</b>`;

    const rm = reportFiltersKeyboard({ year, monthIndex, selectedKeys });
    await editMsgSafe(bot, q, textMsg, rm); // ✅ safe edit
}

async function handleMonthReport(bot, q, chatId, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    // ✅ loading (oy bosilganda)
    await safeAnswer(bot, q, "⏳ Hisobot tayyorlanmoqda...");

    const selectedKeys = await getSelectedExpenseKeys(userId, year, monthIndex);

    const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: selectedKeys });

    await editReportMessage(bot, q, rep, year, monthIndex, selectedKeys);

    // txt file alohida yuboramiz
    await bot.sendDocument(chatId, rep.filePath, { caption: `📄 Batafsil oylik hisobot: ${rep.fileName}` });

    if (GROUP_CHAT_ID) {
        await bot.sendDocument(GROUP_CHAT_ID, rep.filePath, { caption: `📄 Oylik hisobot (${rep.monthTitle})` });
    }

    return true;
}

// ✅ filter toggle
async function handleReportFilterToggle(bot, q, userId) {
    const [, y, m, key] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ Yangilanmoqda...");

    const allKeys = allExpenseKeys();
    const current = await getSelectedExpenseKeys(userId, year, monthIndex);

    const set = new Set(current);
    if (set.has(key)) set.delete(key);
    else set.add(key);

    // ✅ hech narsa qolmasa ALLga qaytaramiz
    const nextKeys = set.size ? Array.from(set) : allKeys;

    // ✅ o'zgarmagan bo'lsa edit qilmaymiz
    const same = current.length === nextKeys.length && nextKeys.every(k => current.includes(k));
    if (same) {
        await safeAnswer(bot, q, "✅");
        return true;
    }

    await setSelectedExpenseKeys(userId, year, monthIndex, nextKeys);

    const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: nextKeys });
    await editReportMessage(bot, q, rep, year, monthIndex, nextKeys);

    return true;
}

// ✅ filter all
async function handleReportFilterAll(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ All...");

    const allKeys = allExpenseKeys();
    const current = await getSelectedExpenseKeys(userId, year, monthIndex);

    const same = current.length === allKeys.length && allKeys.every(k => current.includes(k));
    if (same) {
        await safeAnswer(bot, q, "✅ All tanlangan");
        return true;
    }

    await setSelectedExpenseKeys(userId, year, monthIndex, allKeys);

    const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: allKeys });
    await editReportMessage(bot, q, rep, year, monthIndex, allKeys);

    return true;
}

// ✅ filter clear (siz hozircha Clear = ALL deb xohlagansiz)
async function handleReportFilterNone(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ Clear...");

    const allKeys = allExpenseKeys();
    const current = await getSelectedExpenseKeys(userId, year, monthIndex);

    // Clear = ALL bo'lsa va all bo'lib turgan bo'lsa -> edit qilmaymiz
    const same = current.length === allKeys.length && allKeys.every(k => current.includes(k));
    if (same) {
        await safeAnswer(bot, q, "🧹 Clear (All)");
        return true;
    }

    await setSelectedExpenseKeys(userId, year, monthIndex, allKeys);

    const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: allKeys });
    await editReportMessage(bot, q, rep, year, monthIndex, allKeys);

    return true;
}

// ✅ refresh
async function handleReportRefresh(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "🔄 Yangilanmoqda...");

    const keys = await getSelectedExpenseKeys(userId, year, monthIndex);
    const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: keys });
    await editReportMessage(bot, q, rep, year, monthIndex, keys);

    return true;
}

// ===================== MAIN CALLBACK =====================
async function onCallback(bot, q) {
    const msg = q.message;
    const chatId = msg.chat.id;
    const from = q.from;
    const data = q.data || "";
    const seller = getSeller(from);
    // ✅ SPINNERNI DARROV O‘CHIRADI
    try { await bot.answerCallbackQuery(q.id); } catch { }

    try {
        // noop
        if (data === "noop") {
            await safeAnswer(bot, q, "✅");
            return;
        }

        // ✅ 1) flows first
        if (typeof onExpenseCallback === "function" && (await onExpenseCallback(bot, q, seller))) return;
        if (typeof onPurchaseCallback === "function" && (await onPurchaseCallback(bot, q, seller))) return;

        // ✅ 2) delete
        if (data.startsWith("del_sale:")) {
            const id = data.split(":")[1];
            const sale = await Sale.findById(id);
            if (!sale) {
                await safeAnswer(bot, q, "Topilmadi");
                return;
            }
            await safeAnswer(bot, q, "⏳ O‘chirish...");
            await startDeleteFlow(bot, chatId, from.id, "sale", id, sale.orderNo);
            return;
        }

        if (data.startsWith("del_exp:")) {
            const id = data.split(":")[1];
            const exp = await Expense.findById(id);
            if (!exp) {
                await safeAnswer(bot, q, "Topilmadi");
                return;
            }
            await safeAnswer(bot, q, "⏳ O‘chirish...");
            await startDeleteFlow(bot, chatId, from.id, "expense", id, exp.orderNo);
            return;
        }

        // ✅ 3) debts (customer)
        if (data.startsWith("pay:")) return await handleDebtPayAsk(bot, q, chatId);
        if (data.startsWith("payfull:")) return await handleDebtPayFull(bot, q, chatId, seller);
        if (data.startsWith("paypart:")) return await handleDebtPayPart(bot, q, chatId, from.id);

        // ✅ 4) month report
        if (data.startsWith("rep_month:")) return await handleMonthReport(bot, q, chatId, from.id);

        // ✅ 5) report filters
        if (data.startsWith("rep_f_all:")) return await handleReportFilterAll(bot, q, from.id);
        if (data.startsWith("rep_f_none:")) return await handleReportFilterNone(bot, q, from.id);
        if (data.startsWith("rep_refresh:")) return await handleReportRefresh(bot, q, from.id);
        if (data.startsWith("rep_f:")) return await handleReportFilterToggle(bot, q, from.id);

        // default
        await safeAnswer(bot, q);
    } catch (e) {
        await bot.sendMessage(chatId, `⚠️ Xatolik: ${e.message}`);
        await safeAnswer(bot, q, "⚠️ Xato");
    }
}

module.exports = { onCallback };





// // src/handlers/onCallback.js  (FINAL + REPORT FILTERS)
// const { GROUP_CHAT_ID } = require("../config");

// const Sale = require("../models/Sale");
// const Expense = require("../models/Expense");
// const Debt = require("../models/Debt");

// const { makeMonthlyReport } = require("../services/monthlyReport");
// const { payDebt } = require("../services/debtPay");
// const { sendToGroup } = require("../services/notify");
// const { debtPayNotifyText } = require("../utils/report");
// const { redis } = require("../services/auth");

// const { formatMoney } = require("../utils/money");
// const { getUserName, escapeHtml, payAmountKeyboard } = require("../logic/ui");
// const { startDeleteFlow } = require("../logic/deleteFlow");

// // ✅ flows
// const { onExpenseCallback } = require("./expenseFlow");
// const { onPurchaseCallback } = require("./purchaseFlow");

// // ✅ NEW: report filters keyboard + categories
// const { reportFiltersKeyboard } = require("../keyboards");
// const { EXPENSE_CATEGORIES } = require("../utils/expenseCategories");

// // ===================== HELPERS =====================
// function getSeller(from) {
//     return { tgId: from.id, tgName: getUserName({ from }) };
// }

// async function safeAnswer(bot, q, text) {
//     try {
//         if (text) return await bot.answerCallbackQuery(q.id, { text });
//         return await bot.answerCallbackQuery(q.id);
//     } catch {
//         // ignore
//     }
// }

// // ✅ spinner qolib ketmasin
// async function ack(bot, q) {
//     try { await bot.answerCallbackQuery(q.id); } catch { }
// }

// function normalizePhone(phone) {
//     if (!phone) return null;
//     let p = String(phone).replace(/[^\d]/g, "");
//     if (p.length === 9) p = "998" + p;
//     return p || null;
// }

// // ===================== REPORT FILTER STATE =====================
// const REP_KEY = (userId, y, m) => `rep_filter:${userId}:${y}:${m}`;

// function allExpenseKeys() {
//     return EXPENSE_CATEGORIES.map(x => x.key);
// }

// async function getSelectedExpenseKeys(userId, year, monthIndex) {
//     const raw = await redis.get(REP_KEY(userId, year, monthIndex));
//     if (!raw) return allExpenseKeys(); // ✅ default ALL
//     try {
//         const arr = JSON.parse(raw);
//         if (Array.isArray(arr) && arr.length) return arr;
//         // agar [] bo'lsa ham ALL ko'rsatamiz (siz xohlasangiz [] = 0 qilib ham qilsa bo'ladi)
//         return allExpenseKeys();
//     } catch {
//         return allExpenseKeys();
//     }
// }

// async function setSelectedExpenseKeys(userId, year, monthIndex, keys) {
//     const arr = Array.isArray(keys) ? keys : allExpenseKeys();
//     await redis.set(REP_KEY(userId, year, monthIndex), JSON.stringify(arr), "EX", 60 * 60);
// }

// // ===================== DEBT (CUSTOMER) =====================
// async function handleDebtPayAsk(bot, q, chatId) {
//     const debtId = q.data.split(":")[1];
//     const debt = await Debt.findById(debtId);

//     if (!debt) {
//         await safeAnswer(bot, q, "Qarz topilmadi");
//         return true;
//     }

//     // faqat customer debt
//     if (debt.kind && debt.kind !== "customer") {
//         await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
//         return true;
//     }

//     await bot.sendMessage(
//         chatId,
//         `📌 Qarz: <b>${escapeHtml(debt.note || "-")}</b>\n` +
//         `Qolgan: <b>${formatMoney(debt.remainingDebt)}</b> so'm\n` +
//         `Qanday to'laysiz?`,
//         { parse_mode: "HTML", ...payAmountKeyboard(debtId) }
//     );

//     await safeAnswer(bot, q);
//     return true;
// }

// async function handleDebtPayFull(bot, q, chatId, seller) {
//     const debtId = q.data.split(":")[1];
//     const debt = await Debt.findById(debtId);

//     if (!debt) {
//         await safeAnswer(bot, q, "Qarz topilmadi");
//         return true;
//     }

//     if (debt.kind && debt.kind !== "customer") {
//         await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
//         return true;
//     }

//     const { debt: updated, actualPay } = await payDebt({
//         debtId,
//         amount: debt.remainingDebt,
//         payer: seller
//     });

//     const notify = debtPayNotifyText({
//         payerName: seller.tgName,
//         note: escapeHtml(debt.note || "-"),
//         phone: normalizePhone(debt.customerPhone),
//         paid: actualPay,
//         remaining: updated.remainingDebt
//     });

//     await bot.sendMessage(
//         chatId,
//         `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\n` +
//         `Qolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
//         { parse_mode: "HTML" }
//     );

//     await sendToGroup(bot, notify);
//     await safeAnswer(bot, q);
//     return true;
// }

// async function handleDebtPayPart(bot, q, chatId, fromId) {
//     const debtId = q.data.split(":")[1];

//     const debt = await Debt.findById(debtId);
//     if (!debt) {
//         await safeAnswer(bot, q, "Qarz topilmadi");
//         return true;
//     }

//     if (debt.kind && debt.kind !== "customer") {
//         await safeAnswer(bot, q, "Bu bo‘lim faqat mijoz qarzi uchun");
//         return true;
//     }

//     await redis.set(`await_pay_amount:${fromId}`, debtId, "EX", 300);
//     await bot.sendMessage(chatId, "✍️ Qancha to'laysiz? (faqat summa yozing, masalan: 30000)");
//     await safeAnswer(bot, q);
//     return true;
// }

// // ===================== MONTH REPORT (EDIT + FILTERS) =====================
// async function editReportMessage(bot, q, rep, year, monthIndex, selectedKeys) {
//     const textMsg =
//         `📆 <b>Oylik hisobot: ${rep.monthTitle}</b>\n\n` +
//         `📦 Kirim (maxsulot keldi): <b>${formatMoney(rep.purchaseSum)}</b> so'm\n` +
//         `🧁 Sotildi (jami savdo): <b>${formatMoney(rep.soldTotal)}</b> so'm\n` +
//         `💰 Sotuvdan tushgan: <b>${formatMoney(rep.paidSum)}</b> so'm\n` +
//         `💸 Chiqimlar: <b>${formatMoney(rep.expenseSum)}</b> so'm\n\n` +
//         `👥 Bizdan qarz (mijozlar): <b>${formatMoney(rep.customerDebtSum)}</b> so'm\n` +
//         `🏭 Bizning qarz (firmalar): <b>${formatMoney(rep.supplierDebtSum)}</b> so'm\n` +
//         `🏦 Kassa balansi: <b>${formatMoney(rep.balance)}</b> so'm\n\n` +
//         `🎛 Filter (Chiqim): <b>${(selectedKeys?.length ? selectedKeys.join(", ") : "ALL")}</b>`;

//     // ✅ Oyni tanlash xabarini edit qilamiz (rasmdagidek chiroyli bo'ladi)
//     return bot.editMessageText(textMsg, {
//         chat_id: q.message.chat.id,
//         message_id: q.message.message_id,
//         parse_mode: "HTML",
//         reply_markup: reportFiltersKeyboard({ year, monthIndex, selectedKeys })
//     });
// }

// async function handleMonthReport(bot, q, chatId, userId) {
//     const [, y, m] = q.data.split(":");
//     const year = parseInt(y, 10);
//     const monthIndex = parseInt(m, 10);

//     const selectedKeys = await getSelectedExpenseKeys(userId, year, monthIndex);

//     // ✅ monthlyReport.js opts bilan ishlaydi
//     const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: selectedKeys });

//     // ✅ message edit + filter buttons
//     await editReportMessage(bot, q, rep, year, monthIndex, selectedKeys);

//     // txt file alohida yuboramiz
//     await bot.sendDocument(chatId, rep.filePath, { caption: `📄 Batafsil oylik hisobot: ${rep.fileName}` });

//     if (GROUP_CHAT_ID) {
//         await bot.sendDocument(GROUP_CHAT_ID, rep.filePath, { caption: `📄 Oylik hisobot (${rep.monthTitle})` });
//     }

//     return true;
// }

// // ✅ filter toggle
// async function handleReportFilterToggle(bot, q, userId) {
//     const [, y, m, key] = q.data.split(":");
//     const year = parseInt(y, 10);
//     const monthIndex = parseInt(m, 10);

//     const allKeys = allExpenseKeys();
//     const current = await getSelectedExpenseKeys(userId, year, monthIndex);

//     const set = new Set(current);
//     if (set.has(key)) set.delete(key);
//     else set.add(key);

//     // ✅ hech narsa qolmasa ham ALLga qaytaramiz (sodda)
//     const nextKeys = set.size ? Array.from(set) : allKeys;

//     await setSelectedExpenseKeys(userId, year, monthIndex, nextKeys);

//     const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: nextKeys });
//     await editReportMessage(bot, q, rep, year, monthIndex, nextKeys);
//     return true;
// }

// // ✅ filter all
// async function handleReportFilterAll(bot, q, userId) {
//     const [, y, m] = q.data.split(":");
//     const year = parseInt(y, 10);
//     const monthIndex = parseInt(m, 10);

//     const allKeys = allExpenseKeys();
//     await setSelectedExpenseKeys(userId, year, monthIndex, allKeys);

//     const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: allKeys });
//     await editReportMessage(bot, q, rep, year, monthIndex, allKeys);
//     return true;
// }

// // ✅ filter clear -> biz ALLga qaytaramiz (xohlasangiz 0 qilib ham qilamiz)
// async function handleReportFilterNone(bot, q, userId) {
//     const [, y, m] = q.data.split(":");
//     const year = parseInt(y, 10);
//     const monthIndex = parseInt(m, 10);

//     const allKeys = allExpenseKeys();
//     await setSelectedExpenseKeys(userId, year, monthIndex, allKeys);

//     const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: allKeys });
//     await editReportMessage(bot, q, rep, year, monthIndex, allKeys);
//     return true;
// }

// // ✅ refresh
// async function handleReportRefresh(bot, q, userId) {
//     const [, y, m] = q.data.split(":");
//     const year = parseInt(y, 10);
//     const monthIndex = parseInt(m, 10);

//     const keys = await getSelectedExpenseKeys(userId, year, monthIndex);
//     const rep = await makeMonthlyReport(year, monthIndex, { expenseCategories: keys });
//     await editReportMessage(bot, q, rep, year, monthIndex, keys);
//     return true;
// }

// // ===================== MAIN CALLBACK =====================
// async function onCallback(bot, q) {
//     const msg = q.message;
//     const chatId = msg.chat.id;
//     const from = q.from;
//     const data = q.data || "";
//     const seller = getSeller(from);

//     // ✅ spinner stop
//     await ack(bot, q);

//     try {
//         // noop
//         if (data === "noop") {
//             await safeAnswer(bot, q, "✅");
//             return;
//         }

//         // ✅ 1) flows always first
//         if (typeof onExpenseCallback === "function" && await onExpenseCallback(bot, q, seller)) return;
//         if (typeof onPurchaseCallback === "function" && await onPurchaseCallback(bot, q, seller)) return;

//         // ✅ 2) delete
//         if (data.startsWith("del_sale:")) {
//             const id = data.split(":")[1];
//             const sale = await Sale.findById(id);
//             if (!sale) return await safeAnswer(bot, q, "Topilmadi");

//             await startDeleteFlow(bot, chatId, from.id, "sale", id, sale.orderNo);
//             return;
//         }

//         if (data.startsWith("del_exp:")) {
//             const id = data.split(":")[1];
//             const exp = await Expense.findById(id);
//             if (!exp) return await safeAnswer(bot, q, "Topilmadi");

//             await startDeleteFlow(bot, chatId, from.id, "expense", id, exp.orderNo);
//             return;
//         }

//         // ✅ 3) debts (customer)
//         if (data.startsWith("pay:")) return await handleDebtPayAsk(bot, q, chatId);
//         if (data.startsWith("payfull:")) return await handleDebtPayFull(bot, q, chatId, seller);
//         if (data.startsWith("paypart:")) return await handleDebtPayPart(bot, q, chatId, from.id);

//         // ✅ 4) month report
//         if (data.startsWith("rep_month:")) return await handleMonthReport(bot, q, chatId, from.id);

//         // ✅ 5) report filters
//         if (data.startsWith("rep_f_all:")) return await handleReportFilterAll(bot, q, from.id);
//         if (data.startsWith("rep_f_none:")) return await handleReportFilterNone(bot, q, from.id);
//         if (data.startsWith("rep_refresh:")) return await handleReportRefresh(bot, q, from.id);
//         if (data.startsWith("rep_f:")) return await handleReportFilterToggle(bot, q, from.id);

//         // default
//         await safeAnswer(bot, q);
//     } catch (e) {
//         await bot.sendMessage(chatId, `⚠️ Xatolik: ${e.message}`);
//     } finally {
//         await safeAnswer(bot, q);
//     }
// }

// module.exports = { onCallback };
