// src/routes/webapp.js
const express = require("express");
const dayjs = require("dayjs");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");

const { verifyTgWebApp } = require("../middlewares/verifyTgWebApp");

function webappRoutes({ botToken, io }) {
    const r = express.Router();

    // =========================================================
    // 📊 SUMMARY (cards)
    // =========================================================
    r.get("/dashboard/summary", verifyTgWebApp(botToken), async (req, res) => {
        try {
            const from = req.query.from
                ? dayjs(req.query.from).startOf("day").toDate()
                : dayjs().startOf("day").toDate();

            const to = req.query.to
                ? dayjs(req.query.to).endOf("day").toDate()
                : dayjs().endOf("day").toDate();

            const dateMatch = { createdAt: { $gte: from, $lte: to } };

            const saleAgg = await Sale.aggregate([
                { $match: dateMatch },
                {
                    $group: {
                        _id: null,
                        soldTotal: { $sum: "$total" },
                        salePaid: { $sum: "$paidTotal" }
                    }
                }
            ]);

            const expenseAgg = await Expense.aggregate([
                { $match: dateMatch },
                {
                    $group: {
                        _id: null,
                        expenseSum: { $sum: "$amount" }
                    }
                }
            ]);

            const customerDebtAgg = await Debt.aggregate([
                { $match: { isClosed: false, kind: "customer" } },
                { $group: { _id: null, sum: { $sum: "$remainingDebt" } } }
            ]);

            const supplierDebtAgg = await Supplier.aggregate([
                { $group: { _id: null, sum: { $sum: "$debt" } } }
            ]);

            const balanceDoc = await Counter.findOne({ key: "balance" });

            res.json({
                ok: true,
                cards: {
                    soldTotal: saleAgg[0]?.soldTotal || 0,
                    salePaid: saleAgg[0]?.salePaid || 0,
                    expenseSum: expenseAgg[0]?.expenseSum || 0,
                    customerDebt: customerDebtAgg[0]?.sum || 0,
                    supplierDebt: supplierDebtAgg[0]?.sum || 0,
                    balance: balanceDoc?.value || 0
                }
            });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    // =========================================================
    // 📋 BUGUNGI RO‘YXAT (sales + expenses)
    // =========================================================
    r.get("/dashboard/activity", verifyTgWebApp(botToken), async (req, res) => {
        try {
            const start = dayjs().startOf("day").toDate();
            const end = dayjs().endOf("day").toDate();

            const sales = await Sale.find({
                createdAt: { $gte: start, $lte: end }
            })
                .sort({ createdAt: -1 })
                .limit(30);

            const expenses = await Expense.find({
                createdAt: { $gte: start, $lte: end }
            })
                .sort({ createdAt: -1 })
                .limit(30);

            res.json({ ok: true, sales, expenses });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    // =========================================================
    // 📈 BUGUN vs KECHA CHART
    // =========================================================
    r.get("/dashboard/chart", verifyTgWebApp(botToken), async (req, res) => {
        try {
            const todayStart = dayjs().startOf("day").toDate();
            const todayEnd = dayjs().endOf("day").toDate();

            const yStart = dayjs().subtract(1, "day").startOf("day").toDate();
            const yEnd = dayjs().subtract(1, "day").endOf("day").toDate();

            const agg = async (from, to) => {
                const r = await Sale.aggregate([
                    { $match: { createdAt: { $gte: from, $lte: to } } },
                    {
                        $group: {
                            _id: { $hour: "$createdAt" },
                            sum: { $sum: "$paidTotal" }
                        }
                    },
                    { $sort: { _id: 1 } }
                ]);

                const map = new Map(r.map(x => [x._id, x.sum]));

                const out = [];
                for (let h = 0; h < 24; h++) {
                    out.push({
                        hour: String(h).padStart(2, "0"),
                        value: map.get(h) || 0
                    });
                }

                return out;
            };

            const today = await agg(todayStart, todayEnd);
            const yesterday = await agg(yStart, yEnd);

            res.json({ ok: true, today, yesterday });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    return r;
}

module.exports = { webappRoutes };
