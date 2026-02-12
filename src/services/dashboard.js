const dayjs = require("dayjs");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");

function toDateRange(fromStr, toStr) {
    const from = fromStr ? dayjs(fromStr) : dayjs().startOf("day");
    const to = toStr ? dayjs(toStr) : dayjs().endOf("day");
    return { from: from.toDate(), to: to.toDate(), fromD: from, toD: to };
}

async function sumAgg(Model, match, field) {
    const r = await Model.aggregate([
        { $match: match },
        { $group: { _id: null, sum: { $sum: `$${field}` } } }
    ]);
    return Number(r?.[0]?.sum || 0);
}

async function hourlySalesLine(day) {
    const start = day.startOf("day").toDate();
    const end = day.endOf("day").toDate();

    const rows = await Sale.aggregate([
        { $match: { createdAt: { $gte: start, $lte: end } } },
        {
            $group: {
                _id: { h: { $hour: "$createdAt" } },
                paid: { $sum: "$paidTotal" },
                total: { $sum: "$total" }
            }
        },
        { $sort: { "_id.h": 1 } }
    ]);

    const map = new Map(rows.map(r => [r._id.h, { paid: r.paid, total: r.total }]));
    const out = [];
    for (let h = 0; h < 24; h++) {
        const v = map.get(h) || { paid: 0, total: 0 };
        out.push({ hour: `${String(h).padStart(2, "0")}:00`, paid: Number(v.paid || 0), total: Number(v.total || 0) });
    }
    return out;
}

async function getSummary(fromStr, toStr) {
    const { from, to, fromD } = toDateRange(fromStr, toStr);

    // sales
    const paidSum = await sumAgg(Sale, { createdAt: { $gte: from, $lte: to } }, "paidTotal");
    const debtSum = await sumAgg(Sale, { createdAt: { $gte: from, $lte: to } }, "debtTotal");
    const soldTotal = paidSum + debtSum;

    // expenses
    const expenseSum = await sumAgg(Expense, { createdAt: { $gte: from, $lte: to } }, "amount");

    // customer debts (bizdan qarz)
    const customerDebtSum = await sumAgg(
        Debt,
        { isClosed: false, $or: [{ kind: { $exists: false } }, { kind: "customer" }] },
        "remainingDebt"
    );

    // our debts to suppliers (Supplier.debt)
    const supplierDebtAgg = await Supplier.aggregate([{ $group: { _id: null, sum: { $sum: "$debt" } } }]);
    const supplierDebtSum = Number(supplierDebtAgg?.[0]?.sum || 0);

    // balance
    const balanceDoc = await Counter.findOne({ key: "balance" });
    const balance = Number(balanceDoc?.value || 0);

    // lines today vs yesterday (soatli)
    const todayLine = await hourlySalesLine(fromD);
    const yesterdayLine = await hourlySalesLine(fromD.subtract(1, "day"));

    return {
        range: { from: dayjs(from).format("YYYY.MM.DD"), to: dayjs(to).format("YYYY.MM.DD") },
        cards: {
            soldTotal,
            paidSum,
            expenseSum,
            customerDebtSum,
            supplierDebtSum,
            balance
        },
        chart: { today: todayLine, yesterday: yesterdayLine }
    };
}

async function getTodayActivity() {
    const start = dayjs().startOf("day").toDate();
    const end = dayjs().endOf("day").toDate();

    const sales = await Sale.find({ createdAt: { $gte: start, $lte: end } })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

    const expenses = await Expense.find({ createdAt: { $gte: start, $lte: end } })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

    // bitta ro‘yxat qilib birlashtiramiz
    const list = [
        ...sales.map(s => ({
            type: "sale",
            at: s.createdAt,
            title: `Sotuv: ${s.items?.[0]?.name || "Mahsulot"}`,
            amount: s.paidTotal,
            extra: s.debtTotal > 0 ? `Qarz: ${s.debtTotal}` : ""
        })),
        ...expenses.map(e => ({
            type: "expense",
            at: e.createdAt,
            title: `Chiqim: ${e.categoryKey}`,
            amount: e.amount,
            extra: e.title ? `(${e.title})` : ""
        }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);

    return { list };
}

module.exports = { getSummary, getTodayActivity };
