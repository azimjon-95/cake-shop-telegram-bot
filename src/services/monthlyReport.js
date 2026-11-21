// src/services/monthlyReport.js (FINAL + FILTERS)
const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");

const Sale = require("../models/Sale");
const Purchase = require("../models/Purchase");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const { currentBranch, normBranch, withBranch, branchName } = require("./branches");
const { balanceFor, supplierDebtSum } = require("./branchData");

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
    // Hisobot shu filial uchun (berilmasa — joriy filial)
    const branch = normBranch(opts.branchId || currentBranch());
    const monthTitle = dayjs(start).format("MMMM-YY");

    // ✅ expense filter keys
    const expenseCats = Array.isArray(opts.expenseCategories) ? opts.expenseCategories : null;

    // ✅ 1) Sales
    const paidSum = await sumAgg(Sale, withBranch({ createdAt: { $gte: start, $lt: end } }, branch), "paidTotal");
    const debtFromSales = await sumAgg(Sale, withBranch({ createdAt: { $gte: start, $lt: end } }, branch), "debtTotal");
    const soldTotal = paidSum + debtFromSales;

    // ✅ 2) Purchases
    const purchaseSum = await sumAgg(Purchase, withBranch({ createdAt: { $gte: start, $lt: end } }, branch), "totalCost");

    // ✅ 3) Expenses (FILTER!)
    const expenseMatch = { createdAt: { $gte: start, $lt: end } };
    if (expenseCats && expenseCats.length) {
        expenseMatch.categoryKey = { $in: expenseCats };
    }
    const expenseSum = await sumAgg(Expense, withBranch(expenseMatch, branch), "amount");

    // ✅ 4) Customer debts (bizdan qarz) -> Debt.js
    const customerDebtSum = await sumAgg(
        Debt,
        withBranch({ isClosed: false, $or: [{ kind: { $exists: false } }, { kind: "customer" }] }, branch),
        "remainingDebt"
    );

    // ✅ 5) Supplier debts (bizning qarz) -> Supplier.debt
    const supplierDebtTotal = await supplierDebtSum(branch);

    // ✅ 6) Cash balance
    const balance = await balanceFor(branch);

    // ✅ TXT
    const lines = [];
    lines.push(`OYLIK HISOBOT: ${dayjs(start).format("YYYY-MM")} — ${branchName(branch)}`);
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
    lines.push(`🏭 Bizning qarz (firmalar): ${formatMoney(supplierDebtTotal)} so'm`);
    lines.push(`🏦 Kassa balansi: ${formatMoney(balance)} so'm`);

    const fileName = `oylik_hisobot_${branch}_${dayjs(start).format("YYYY-MM")}.txt`;
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
        supplierDebtSum: supplierDebtTotal,
        balance,
        branchId: branch,
        fileName,
        filePath,
        expenseCats
    };
}

module.exports = { makeMonthlyReport };
