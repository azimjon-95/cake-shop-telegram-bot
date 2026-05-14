// src/handlers/onCallback.js
const { GROUP_CHAT_ID } = require("../config");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const { getExpenseReportData, buildExpenseTxtReport } = require("../services/expenseReport");
const { getReportState } = require("./message/expenseReportRouter");
const { makeMonthlyReport } = require("../services/monthlyReport");
const { payDebt } = require("../services/debtPay");
const { sendToGroup } = require("../services/notify");
const { debtPayNotifyText } = require("../utils/report");
const { redis } = require("../services/auth");
const Worker = require("../models/Worker");
const { formatMoney } = require("../utils/money");
const { getUserName, escapeHtml, payAmountKeyboard } = require("../logic/ui");
const { startDeleteFlow } = require("../logic/deleteFlow");

const { onExpenseCallback } = require("./expenseFlow");
const { onPurchaseCallback } = require("./purchaseFlow");

const {
    addSaleDraftItem,
    clearSaleDraft,
    buildSaleDraftText,
    getSaleTemplateCategory,
    setSaleTemplateCategory,
} = require("../logic/saleDraft");

const {
    reportFiltersKeyboard,
    saleTemplatesKeyboard,
    saleInputModeKeyboard,
} = require("../keyboards");

const { EXPENSE_CATEGORIES } = require("../utils/expenseCategories");

// ===================== HELPERS =====================
function getSeller(from) {
    return { tgId: from.id, tgName: getUserName({ from }) };
}

async function safeAnswer(bot, q, text) {
    try {
        if (text) {
            return await bot.answerCallbackQuery(q.id, { text });
        }
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

async function editMsgSafe(bot, q, text, reply_markup) {
    try {
        return await bot.editMessageText(text, {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
            parse_mode: "HTML",
            reply_markup,
        });
    } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("message is not modified")) return null;
        throw e;
    }
}

// ===================== REPORT FILTER STATE =====================
const REP_KEY = (userId, y, m) => `rep_filter:${userId}:${y}:${m}`;

function allExpenseKeys() {
    return EXPENSE_CATEGORIES.map((x) => x.key);
}

async function getSelectedExpenseKeys(userId, year, monthIndex) {
    const raw = await redis.get(REP_KEY(userId, year, monthIndex));
    if (!raw) return allExpenseKeys();

    try {
        const arr = JSON.parse(raw);
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
        payer: seller,
    });

    const notify = debtPayNotifyText({
        payerName: seller.tgName,
        note: escapeHtml(debt.note || "-"),
        phone: normalizePhone(debt.customerPhone),
        paid: actualPay,
        remaining: updated.remainingDebt,
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

// ===================== MONTH REPORT =====================
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
        `🎛 Filter (Chiqim): <b>${selectedKeys?.length ? selectedKeys.join(", ") : "ALL"}</b>`;

    const rm = reportFiltersKeyboard({ year, monthIndex, selectedKeys });
    await editMsgSafe(bot, q, textMsg, rm);
}

async function handleMonthReport(bot, q, chatId, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ Hisobot tayyorlanmoqda...");

    const selectedKeys = await getSelectedExpenseKeys(userId, year, monthIndex);
    const rep = await makeMonthlyReport(year, monthIndex, {
        expenseCategories: selectedKeys,
    });

    await editReportMessage(bot, q, rep, year, monthIndex, selectedKeys);

    await bot.sendDocument(chatId, rep.filePath, {
        caption: `📄 Batafsil oylik hisobot: ${rep.fileName}`,
    });

    if (GROUP_CHAT_ID) {
        await bot.sendDocument(GROUP_CHAT_ID, rep.filePath, {
            caption: `📄 Oylik hisobot (${rep.monthTitle})`,
        });
    }

    return true;
}

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

    const nextKeys = set.size ? Array.from(set) : allKeys;

    const same =
        current.length === nextKeys.length &&
        nextKeys.every((k) => current.includes(k));

    if (same) {
        await safeAnswer(bot, q, "✅");
        return true;
    }

    await setSelectedExpenseKeys(userId, year, monthIndex, nextKeys);

    const rep = await makeMonthlyReport(year, monthIndex, {
        expenseCategories: nextKeys,
    });

    await editReportMessage(bot, q, rep, year, monthIndex, nextKeys);
    return true;
}

async function handleReportFilterAll(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ All...");

    const allKeys = allExpenseKeys();
    const current = await getSelectedExpenseKeys(userId, year, monthIndex);

    const same =
        current.length === allKeys.length &&
        allKeys.every((k) => current.includes(k));

    if (same) {
        await safeAnswer(bot, q, "✅ All tanlangan");
        return true;
    }

    await setSelectedExpenseKeys(userId, year, monthIndex, allKeys);

    const rep = await makeMonthlyReport(year, monthIndex, {
        expenseCategories: allKeys,
    });

    await editReportMessage(bot, q, rep, year, monthIndex, allKeys);
    return true;
}

async function handleReportFilterNone(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "⏳ Clear...");

    const allKeys = allExpenseKeys();
    const current = await getSelectedExpenseKeys(userId, year, monthIndex);

    // Agar hech narsa tanlanmagan bo'lsa (allKeys bilan teng), hammasini tanlamay qo'yamiz
    // Bu yerda "Clear" = hammani o'chirib, faqat birinchi categoryni qoldirish emas,
    // balki "None" = bo'sh tanlash (filter yo'q = hammasini ko'rsatish bilan teng)
    const same =
        current.length === allKeys.length &&
        allKeys.every((k) => current.includes(k));

    // Agar hamma allaqachon tanlangan bo'lsa - hammani olib tashlaymiz (toggle)
    const nextKeys = same ? [] : allKeys;
    const effectiveKeys = nextKeys.length ? nextKeys : allKeys;

    await setSelectedExpenseKeys(userId, year, monthIndex, effectiveKeys);

    const rep = await makeMonthlyReport(year, monthIndex, {
        expenseCategories: effectiveKeys,
    });

    await editReportMessage(bot, q, rep, year, monthIndex, effectiveKeys);
    return true;
}

async function handleReportRefresh(bot, q, userId) {
    const [, y, m] = q.data.split(":");
    const year = parseInt(y, 10);
    const monthIndex = parseInt(m, 10);

    await safeAnswer(bot, q, "🔄 Yangilanmoqda...");

    const keys = await getSelectedExpenseKeys(userId, year, monthIndex);
    const rep = await makeMonthlyReport(year, monthIndex, {
        expenseCategories: keys,
    });

    await editReportMessage(bot, q, rep, year, monthIndex, keys);
    return true;
}

// ===================== SALE TEMPLATE =====================
async function renderSaleTemplateMessage(bot, q, userId, noteText = "") {
    const draftText = await buildSaleDraftText(userId);
    const currentCategory = await getSaleTemplateCategory(userId);

    const text =
        `Kerakli mahsulot nomlarini tanlang.\n` +
        `Tanlanganlar:\n` +
        `<code>${escapeHtml(draftText || "—")}</code>` +
        (noteText ? `\n\n${escapeHtml(noteText)}` : "");

    await editMsgSafe(bot, q, text, saleTemplatesKeyboard(currentCategory));
}

async function handleSaleTemplateOpen(bot, q, userId) {
    await clearSaleDraft(userId);
    await setSaleTemplateCategory(userId, "tortlar");
    await renderSaleTemplateMessage(bot, q, userId);
    return true;
}

async function handleSaleTemplateCategory(bot, q, userId) {
    const category = q.data.split(":")[1];
    await setSaleTemplateCategory(userId, category);
    await renderSaleTemplateMessage(bot, q, userId);
    return true;
}

async function handleSaleTemplateAdd(bot, q, userId) {
    const itemName = q.data.split("sale_tpl_add:")[1];

    await addSaleDraftItem(userId, itemName);
    await safeAnswer(bot, q, `Qo‘shildi: ${itemName}`);
    await renderSaleTemplateMessage(bot, q, userId);

    return true;
}

async function handleSaleTemplateClear(bot, q, userId) {
    await clearSaleDraft(userId);
    await renderSaleTemplateMessage(bot, q, userId);
    return true;
}

async function handleSaleTemplateCancel(bot, q, userId) {
    await clearSaleDraft(userId);

    await editMsgSafe(
        bot,
        q,
        "Qo‘lda yozish rejimiga qaytdingiz.\nSotuvni matn ko‘rinishida yuboring.",
        saleInputModeKeyboard()
    );

    return true;
}

// ===================== MAIN CALLBACK =====================
async function onCallback(bot, q) {
    const msg = q.message;
    const chatId = msg.chat.id;
    const from = q.from;
    const userId = from.id;
    const data = q.data || "";
    const seller = getSeller(from);

    try {
        try {
            await bot.answerCallbackQuery(q.id);
        } catch {
            // ignore
        }

        if (data === "noop") {
            await safeAnswer(bot, q, "✅");
            return;
        }

        // 1) sale templates
        if (data === "sale_tpl_open") return await handleSaleTemplateOpen(bot, q, userId);
        if (data.startsWith("sale_tpl_cat:")) return await handleSaleTemplateCategory(bot, q, userId);
        if (data.startsWith("sale_tpl_add:")) return await handleSaleTemplateAdd(bot, q, userId);
        if (data === "sale_tpl_clear") return await handleSaleTemplateClear(bot, q, userId);
        if (data === "sale_tpl_cancel") return await handleSaleTemplateCancel(bot, q, userId);

        // 2) flows
        if (typeof onExpenseCallback === "function" && (await onExpenseCallback(bot, q, seller))) return;
        if (typeof onPurchaseCallback === "function" && (await onPurchaseCallback(bot, q, seller))) return;

        // 3) delete
        if (data.startsWith("del_sale:")) {
            const id = data.split(":")[1];
            const sale = await Sale.findById(id);

            if (!sale) {
                await safeAnswer(bot, q, "Topilmadi");
                return;
            }

            await safeAnswer(bot, q, "⏳ O‘chirish...");
            await startDeleteFlow(bot, chatId, userId, "sale", id, sale.orderNo);
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
            await startDeleteFlow(bot, chatId, userId, "expense", id, exp.orderNo);
            return;
        }

        // 4) debts
        if (data.startsWith("pay:")) return await handleDebtPayAsk(bot, q, chatId);
        if (data.startsWith("payfull:")) return await handleDebtPayFull(bot, q, chatId, seller);
        if (data.startsWith("paypart:")) return await handleDebtPayPart(bot, q, chatId, userId);

        // 5) month report
        if (data.startsWith("rep_month:")) return await handleMonthReport(bot, q, chatId, userId);

        // 6) report filters
        if (data.startsWith("rep_f_all:")) return await handleReportFilterAll(bot, q, userId);
        if (data.startsWith("rep_f_none:")) return await handleReportFilterNone(bot, q, userId);
        if (data.startsWith("rep_refresh:")) return await handleReportRefresh(bot, q, userId);
        if (data.startsWith("rep_f:")) return await handleReportFilterToggle(bot, q, userId);

        if (data.startsWith("del_worker:")) {

            const id = data.split(":")[1];

            const worker = await Worker.findById(id);

            if (!worker) {
                return bot.answerCallbackQuery(q.id, {
                    text: "Worker topilmadi"
                });
            }

            await Worker.deleteOne({ _id: id });

            await bot.answerCallbackQuery(q.id, {
                text: "Worker o‘chirildi"
            });

            await bot.editMessageText(
                `❌ Worker o‘chirildi\n👤 ${worker.fullName}`,
                {
                    chat_id: q.message.chat.id,
                    message_id: q.message.message_id
                }
            );
        }

        if (data === "exp_report_txt") {
            const state = await getReportState(q.from.id);

            if (!state?.from || !state?.to || !state?.categoryKey) {
                await bot.answerCallbackQuery(q.id, { text: "Hisobot ma’lumoti topilmadi" });
                return;
            }

            const from = new Date(state.from);
            const to = new Date(state.to);

            const reportData = await getExpenseReportData(from, to, state.categoryKey);
            const file = await buildExpenseTxtReport(reportData);

            await bot.answerCallbackQuery(q.id, { text: "📄 TXT tayyorlandi" });

            return bot.sendDocument(
                q.message.chat.id,
                file.filePath,
                {},
                { filename: file.fileName }
            );
        }

        await safeAnswer(bot, q);
    } catch (e) {
        await bot.sendMessage(chatId, `⚠️ Xatolik: ${e.message}`);
        await safeAnswer(bot, q, "⚠️ Xato");
    }
}

module.exports = { onCallback };