const fs = require("fs");
const path = require("path");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Counter = require("../models/Counter");
const { formatMoney } = require("../utils/money");
const { startOfToday, formatHM, formatMonthYear } = require("../utils/time");

async function closeCashAndMakeReport() {
    const from = startOfToday();
    const to = new Date();

    const [sales, expenses, debtsOpen, balance] = await Promise.all([
        Sale.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
        Expense.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
        Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(200),
        Counter.findOne({ key: "balance" })
    ]);

    const saleSum = sales.reduce((a, s) => a + (s.paidTotal || 0), 0);
    const expenseSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const debtSum = debtsOpen.reduce((a, d) => a + (d.remainingDebt || 0), 0);

    const txtLines = [];
    txtLines.push(`KUNLIK HISOBOT (${formatMonthYear(new Date())})`);
    txtLines.push(`Vaqt oralig‘i: ${formatHM(from)} → ${formatHM(to)}`);
    txtLines.push("");
    txtLines.push(`Sotuvdan tushgan pul: ${formatMoney(saleSum)} so‘m`);
    txtLines.push(`Chiqimlar: ${formatMoney(expenseSum)} so‘m`);
    txtLines.push(`Ochiq qarzlar (qolgan): ${formatMoney(debtSum)} so‘m`);
    txtLines.push(`Kassa balansi: ${formatMoney(balance?.value || 0)} so‘m`);
    txtLines.push("");

    // ================= SOTUVLAR =================
    txtLines.push("================= SOTUVLAR =================");
    for (const s of sales) {
        txtLines.push(
            `- ${formatHM(s.createdAt)} | ${s.seller.tgName} | `
            + `Tushim: ${formatMoney(s.paidTotal)} so‘m | `
            + `Qarz: ${formatMoney(s.debtTotal)} so‘m | `
            + `${s.items.map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`).join(", ")}`
        );
    }

    txtLines.push("");

    // ================= CHIQIMLAR =================
    txtLines.push("================= CHIQIMLAR =================");
    for (const e of expenses) {
        txtLines.push(
            `- ${formatHM(e.createdAt)} | ${e.spender.tgName} | `
            + `${e.title} | -${formatMoney(e.amount)} so‘m`
        );
    }

    txtLines.push("");

    // ================= QARZLAR =================
    txtLines.push("=============== OCHIQ QARZLAR ===============");
    for (const d of debtsOpen) {
        txtLines.push(
            `- ${formatHM(d.createdAt)} | ${d.seller.tgName} | `
            + `${d.note} | Tel: ${d.customerPhone || "-"} | `
            + `Qolgan: ${formatMoney(d.remainingDebt)} so‘m`
        );
    }

    const reportDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const fileName = `hisobot_${new Date().toISOString().slice(0, 10)}.txt`;
    const filePath = path.join(reportDir, fileName);
    fs.writeFileSync(filePath, txtLines.join("\n"), "utf8");

    return {
        saleSum,
        expenseSum,
        debtSum,
        balance: balance?.value || 0,
        from,
        to,
        filePath,
        fileName
    };
}

module.exports = { closeCashAndMakeReport };
