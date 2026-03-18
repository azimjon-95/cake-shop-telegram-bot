const fs = require("fs");
const path = require("path");
const dayjs = require("dayjs");
const Expense = require("../models/Expense");
const { formatMoney } = require("../utils/money");
const Sale = require("../models/Sale");

function getDefaultRange() {
    return {
        from: dayjs().startOf("month").toDate(),
        to: new Date()
    };
}

function parseDateRange(text) {
    const s = String(text || "").trim();
    const m = s.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})\s*-\s*(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
    if (!m) return null;

    const from = dayjs(`${m[1]}-${m[2]}-${m[3]} 00:00:00`);
    const to = dayjs(`${m[4]}-${m[5]}-${m[6]} 23:59:59`);

    if (!from.isValid() || !to.isValid() || to.isBefore(from)) return null;

    return { from: from.toDate(), to: to.toDate() };
}

function getExpenseCategoryTitle(categoryKey) {
    const map = {
        other: "Proche rasxodlar",
        rent: "Arenda",
        electricity: "Elektr energiya",
        supplier: "Firma (Taminotga)",
        cash: "Kapilka",
        worker: "Ishchiga",
        food: "Abetga",
        taxi: "Taksiga",
        repair: "Ustaga",
        bank: "Bank / Soliq to‘lovlari",
        all: "Hammasi"
    };
    return map[categoryKey] || categoryKey;
}

async function getExpenseReportData(from, to, categoryKey = "all") {
    const query = {
        createdAt: { $gte: from, $lte: to }
    };

    if (categoryKey !== "all") {
        query.categoryKey = categoryKey;
    }

    const expenses = await Expense.find(query).sort({ createdAt: -1 });

    const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return {
        from,
        to,
        categoryKey,
        categoryTitle: getExpenseCategoryTitle(categoryKey),
        expenses,
        totalAmount,
        count: expenses.length
    };
}

async function formatExpenseReportText(data) {
    const fromStr = dayjs(data.from).format("YYYY.MM.DD");
    const toStr = dayjs(data.to).format("YYYY.MM.DD");

    const lines = [
        `💸 <b>Chiqimlar hisobot</b>`,
        `📂 Kategoriya: <b>${data.categoryTitle}</b>`,
        `📅 Oraliq: <b>${fromStr}</b> - <b>${toStr}</b>`,
        `🧾 Soni: <b>${data.count}</b> ta`,
        `💰 Jami chiqim: <b>${formatMoney(data.totalAmount)}</b> so'm`,
        ``
    ];

    if (!data.expenses.length) {
        lines.push("Bu oraliqda chiqim topilmadi.");
    } else {
        const top = data.expenses.slice(0, 30);

        for (const e of top) {
            const label = await buildExpenseLineLabel(e);
            const shortDate = formatShortUzDate(e.createdAt);

            lines.push(`• <b>${label}</b> — ${formatMoney(e.amount)} so'm, ${shortDate}`);
        }

        if (data.expenses.length > 30) {
            lines.push("");
            lines.push(`... yana ${data.expenses.length - 30} ta chiqim bor`);
        }
    }

    lines.push("");
    lines.push(`Agar boshqa oraliq kerak bo‘lsa, shu formatda yuboring:`);
    lines.push(`<code>2026.03.01 - 2026.03.14</code>`);

    return lines.join("\n");
}


async function buildExpenseTxtReport(data) {
    const reportsDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const fromStr = dayjs(data.from).format("YYYY-MM-DD");
    const toStr = dayjs(data.to).format("YYYY-MM-DD");
    const cat = data.categoryKey || "all";

    const fileName = `chiqimlar_${cat}_${fromStr}_${toStr}.txt`;
    const filePath = path.join(reportsDir, fileName);

    const lines = [
        `CHIQIMLAR HISOBOT`,
        `Kategoriya: ${data.categoryTitle}`,
        `Oraliq: ${fromStr} - ${toStr}`,
        `Soni: ${data.count}`,
        `Jami: ${formatMoney(data.totalAmount)} so'm`,
        ``,
        `----------------------------------------`,
    ];

    for (const [idx, e] of data.expenses.entries()) {
        const label = await buildExpenseLineLabel(e);

        lines.push(
            `${idx + 1}. ${label}`,
            `   Summa: ${formatMoney(e.amount)} so'm`,
            `   Kategoriya: ${e.categoryKey || "-"}`,
            `   Sana: ${dayjs(e.createdAt).format("YYYY.MM.DD HH:mm")}`,
            `   Description: ${e.description || "-"}`,
            `----------------------------------------`
        );
    }

    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    return { fileName, filePath };
}


const WORKER_NAME_FROM_HOUR = 8;
const WORKER_NAME_TO_HOUR = 11;

async function inferWorkerNameForExpense(expense) {
    const d = dayjs(expense.createdAt);

    const from = d.hour(WORKER_NAME_FROM_HOUR).minute(0).second(0).millisecond(0).toDate();
    const to = d.hour(WORKER_NAME_TO_HOUR).minute(0).second(0).millisecond(0).toDate();

    const sales = await Sale.find({
        createdAt: { $gte: from, $lte: to }
    }).lean();

    if (!sales.length) {
        return expense.spender?.tgName || "Noma'lum";
    }

    const stats = new Map();

    for (const sale of sales) {
        const tgId = sale?.seller?.tgId;
        const tgName = sale?.seller?.tgName || "Noma'lum";
        const paidTotal = Number(sale?.paidTotal || 0);

        if (!tgId) continue;

        if (!stats.has(tgId)) {
            stats.set(tgId, { tgId, tgName, count: 0, paidTotal: 0 });
        }

        const row = stats.get(tgId);
        row.count += 1;
        row.paidTotal += paidTotal;
    }

    const ranked = [...stats.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.paidTotal !== a.paidTotal) return b.paidTotal - a.paidTotal;
        return String(a.tgName).localeCompare(String(b.tgName));
    });

    return ranked[0]?.tgName || expense.spender?.tgName || "Noma'lum";
}


function formatShortUzDate(date) {
    const months = [
        "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
        "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"
    ];

    const d = dayjs(date);
    return `${d.date()}-${months[d.month()]}`;
}
async function buildExpenseLineLabel(expense) {
    // Worker category bo‘lsa kim olganini aniqlaymiz
    if (expense.categoryKey === "worker") {
        const workerName = await inferWorkerNameForExpense(expense);
        return workerName;
    }

    // Description bo‘lsa description ni ko‘rsatamiz
    if (expense.description && String(expense.description).trim()) {
        return String(expense.description).trim();
    }

    // Title meaningful bo‘lsa title
    if (expense.title && expense.title !== "Chiqim") {
        return expense.title;
    }

    // Default fallback
    return expense.title || "Chiqim";
}

module.exports = {
    getDefaultRange,
    parseDateRange,
    getExpenseReportData,
    formatExpenseReportText,
    buildExpenseTxtReport,
    getExpenseCategoryTitle,
    inferWorkerNameForExpense,
    formatShortUzDate,
    buildExpenseLineLabel
};
