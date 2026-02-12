// src/services/monthlyReport.js (FINAL + FILTERS)
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");

const Sale = require("../models/Sale");
const Purchase = require("../models/Purchase");
const Expense = require("../models/Expense");
const Supplier = require("../models/Supplier");
const Debt = require("../models/Debt");
const Counter = require("../models/Counter");

const { formatMoney } = require("../utils/money");

function monthRange(year, monthIndex) {
    // monthIndex: 0..11
    const start = dayjs(new Date(year, monthIndex, 1)).startOf("month").toDate();
    // ✅ exclusive end (next month start)
    const end = dayjs(new Date(year, monthIndex, 1)).add(1, "month").startOf("month").toDate();
    return { start, end };
}

async function sumAgg(Model, match, field) {
    const r = await Model.aggregate([
        { $match: match },
        { $group: { _id: null, sum: { $sum: `$${field}` } } }
    ]);
    return Number(r?.[0]?.sum || 0);
}

async function makeMonthlyReport(year, monthIndex, opts = {}) {
    const { start, end } = monthRange(year, monthIndex);
    const monthTitle = dayjs(start).format("MMMM-YY");

    // ✅ expense filter keys
    const expenseCats = Array.isArray(opts.expenseCategories) ? opts.expenseCategories : null;

    // ✅ 1) Sales
    const paidSum = await sumAgg(Sale, { createdAt: { $gte: start, $lt: end } }, "paidTotal");
    const debtFromSales = await sumAgg(Sale, { createdAt: { $gte: start, $lt: end } }, "debtTotal");
    const soldTotal = paidSum + debtFromSales;

    // ✅ 2) Purchases
    const purchaseSum = await sumAgg(Purchase, { createdAt: { $gte: start, $lt: end } }, "totalCost");

    // ✅ 3) Expenses (FILTER!)
    const expenseMatch = { createdAt: { $gte: start, $lt: end } };
    if (expenseCats && expenseCats.length) {
        expenseMatch.categoryKey = { $in: expenseCats };
    }
    const expenseSum = await sumAgg(Expense, expenseMatch, "amount");

    // ✅ 4) Customer debts (bizdan qarz) -> Debt.js
    const customerDebtSum = await sumAgg(
        Debt,
        { isClosed: false, $or: [{ kind: { $exists: false } }, { kind: "customer" }] },
        "remainingDebt"
    );

    // ✅ 5) Supplier debts (bizning qarz) -> Supplier.debt
    const supplierDebtAgg = await Supplier.aggregate([
        { $group: { _id: null, sum: { $sum: "$debt" } } }
    ]);
    const supplierDebtSum = Number(supplierDebtAgg?.[0]?.sum || 0);

    // ✅ 6) Cash balance
    const balanceDoc = await Counter.findOne({ key: "balance" });
    const balance = Number(balanceDoc?.value || 0);

    // ✅ TXT
    const lines = [];
    lines.push(`OYLIK HISOBOT: ${dayjs(start).format("YYYY-MM")}`);
    lines.push(
        `Oraliq: ${dayjs(start).format("YYYY-MM-DD")} -> ${dayjs(end).subtract(1, "day").format("YYYY-MM-DD")}`
    );
    lines.push("");

    lines.push(`📦 Kirim (maxsulot keldi): ${formatMoney(purchaseSum)} so'm`);
    lines.push(`🧁 Sotildi (jami savdo): ${formatMoney(soldTotal)} so'm`);
    lines.push(`💰 Sotuvdan tushgan: ${formatMoney(paidSum)} so'm`);

    if (expenseCats && expenseCats.length) {
        lines.push(`🎛 Filter (Chiqim): ${expenseCats.join(", ")}`);
    } else {
        lines.push(`🎛 Filter (Chiqim): ALL`);
    }
    lines.push(`💸 Chiqimlar: ${formatMoney(expenseSum)} so'm`);

    lines.push("");
    lines.push(`👥 Bizdan qarz (mijozlar): ${formatMoney(customerDebtSum)} so'm`);
    lines.push(`🏭 Bizning qarz (firmalar): ${formatMoney(supplierDebtSum)} so'm`);
    lines.push(`🏦 Kassa balansi: ${formatMoney(balance)} so'm`);

    const fileName = `oylik_hisobot_${dayjs(start).format("YYYY-MM")}.txt`;
    const filePath = path.join(process.cwd(), fileName);
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");

    return {
        monthTitle,
        range: { start, end },
        purchaseSum,
        soldTotal,
        paidSum,
        expenseSum,
        customerDebtSum,
        supplierDebtSum,
        balance,
        fileName,
        filePath,
        expenseCats
    };
}

module.exports = { makeMonthlyReport };
