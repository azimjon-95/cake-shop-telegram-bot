const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Counter = require("../models/Counter");

const { formatMoney } = require("../utils/money");
const { UZ_MONTHS } = require("../utils/months");

// faqat HH:mm kerak bo'lsa time utilingizdan ham olishingiz mumkin
function fmtDate(d) {
    return dayjs(d).format("YYYY-MM-DD"); // cheslo uchun
}
function fmtTime(d) {
    return dayjs(d).format("HH:mm");
}

async function makeMonthlyReport(year, monthIndex /* 0-11 */) {
    const from = dayjs().year(year).month(monthIndex).startOf("month").toDate();
    const to = dayjs().year(year).month(monthIndex).endOf("month").toDate();

    const [sales, expenses, debtsOpen, balance] = await Promise.all([
        Sale.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
        Expense.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }),
        // Ochiq qarzlar (hozirgi holat) — oy bo'yicha filtrlash shart emas, siz “usha oyniki qolgan” dedingiz:
        // soddaroq: shu oyni ichida yaratilgan qarzlar orasidan yopilmaganlari
        Debt.find({ createdAt: { $gte: from, $lte: to }, isClosed: false }).sort({ createdAt: -1 }).limit(500),
        Counter.findOne({ key: "balance" })
    ]);

    const saleSum = sales.reduce((a, s) => a + (s.paidTotal || 0), 0);
    const expenseSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const debtSum = debtsOpen.reduce((a, d) => a + (d.remainingDebt || 0), 0);

    // === KUNLIK AGGREGATSIA ===
    const dailySales = new Map();   // YYYY-MM-DD -> sum
    const dailyExpenses = new Map();

    for (const s of sales) {
        const key = fmtDate(s.createdAt);
        dailySales.set(key, (dailySales.get(key) || 0) + (s.paidTotal || 0));
    }
    for (const e of expenses) {
        const key = fmtDate(e.createdAt);
        dailyExpenses.set(key, (dailyExpenses.get(key) || 0) + (e.amount || 0));
    }

    const monthTitle = `${UZ_MONTHS[monthIndex]}-${String(year).slice(-2)}`;

    // === TXT REPORT ===
    const lines = [];
    lines.push(`OYLIK HISOBOT: ${monthTitle}`);
    lines.push(`Oraliq: ${fmtDate(from)} -> ${fmtDate(to)}`);
    lines.push("");
    lines.push(`Sotuvdan tushgan pul: ${formatMoney(saleSum)} so‘m`);
    lines.push(`Chiqimlar: ${formatMoney(expenseSum)} so‘m`);
    lines.push(`Ochiq qarzlar (shu oyda yaratilgan, yopilmagan): ${formatMoney(debtSum)} so‘m`);
    lines.push(`Hozirgi kassa balansi: ${formatMoney(balance?.value || 0)} so‘m`);
    lines.push("");

    lines.push("=== KUNLIK YIG‘INDI (SOTUV/CHIQIM) ===");
    // barcha kunlarni birlashtirib chiqamiz
    const allDays = new Set([...dailySales.keys(), ...dailyExpenses.keys()]);
    const sortedDays = Array.from(allDays).sort();
    for (const day of sortedDays) {
        lines.push(
            `- ${day} | Sotuv: ${formatMoney(dailySales.get(day) || 0)} so‘m | Chiqim: ${formatMoney(dailyExpenses.get(day) || 0)} so‘m`
        );
    }

    lines.push("");
    lines.push("=== SOTUVLAR (batafsil) ===");
    for (const s of sales) {
        lines.push(
            `- ${fmtDate(s.createdAt)} ${fmtTime(s.createdAt)} | ${s.seller?.tgName || "-"} | `
            + `Tushgan=${formatMoney(s.paidTotal)} | Qarz=${formatMoney(s.debtTotal)} | `
            + `${(s.items || []).map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`).join(", ")}`
        );
    }

    lines.push("");
    lines.push("=== CHIQIMLAR (batafsil) ===");
    for (const e of expenses) {
        lines.push(
            `- ${fmtDate(e.createdAt)} ${fmtTime(e.createdAt)} | ${e.spender?.tgName || "-"} | ${e.title} | -${formatMoney(e.amount)}`
        );
    }

    lines.push("");
    lines.push("=== OCHIQ QARZLAR (batafsil) ===");
    for (const d of debtsOpen) {
        lines.push(
            `- ${fmtDate(d.createdAt)} ${fmtTime(d.createdAt)} | ${d.seller?.tgName || "-"} | ${d.note} | `
            + `Tel: ${d.customerPhone || "-"} | Qolgan=${formatMoney(d.remainingDebt)}`
        );
    }

    const reportDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const fileName = `oylik_hisobot_${year}-${String(monthIndex + 1).padStart(2, "0")}.txt`;
    const filePath = path.join(reportDir, fileName);
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");

    return {
        monthTitle,
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

module.exports = { makeMonthlyReport };
