// src/routes/webapp.js
const express = require("express");
const moment = require("moment-timezone");

const { makeQrPngBuffer } = require("../services/qr");
const { CUSTOMER_BOT_USERNAME, MIN_QR_PAID, TZ } = require("../config");
const Referral = require("../models/Referral");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");

const ReceiptToken = require("../models/ReceiptToken");
const Customer = require("../models/Customer");

const { verifyTgWebApp } = require("../middlewares/verifyTgWebApp");

// ✅ from/to parse helper (ISO yoki date string)
// Agar from/to berilmasa => bugun (Toshkent TZ)
function getRangeFromQuery(req) {
    const qFrom = req.query.from;
    const qTo = req.query.to;

    if (qFrom && qTo) {
        const from = new Date(qFrom);
        const to = new Date(qTo);
        if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
            return { from, to };
        }
    }

    // fallback => bugun (TZ bilan)
    const zone = TZ || "Asia/Tashkent";
    const from = moment().tz(zone).startOf("day").toDate();
    const to = moment().tz(zone).endOf("day").toDate();
    return { from, to };
}

function webappRoutes({ botToken, customerBotToken, io }) {
    const r = express.Router();

    // =========================
    // 📊 SUMMARY (cards)
    // GET /api/webapp/dashboard/summary?from=ISO&to=ISO
    // =========================
    r.get("/dashboard/summary", async (req, res) => {
        try {
            const { from, to } = getRangeFromQuery(req);
            const dateMatch = { createdAt: { $gte: from, $lte: to } };

            const saleAgg = await Sale.aggregate([
                { $match: dateMatch },
                {
                    $group: {
                        _id: null,
                        soldTotal: { $sum: "$total" },
                        salePaid: { $sum: "$paidTotal" },
                    },
                },
            ]);

            const expenseAgg = await Expense.aggregate([
                { $match: dateMatch },
                { $group: { _id: null, sum: { $sum: "$amount" } } },
            ]);

            const customerDebtAgg = await Debt.aggregate([
                { $match: { isClosed: false, kind: "customer" } },
                { $group: { _id: null, sum: { $sum: "$remainingDebt" } } },
            ]);

            const supplierDebtAgg = await Supplier.aggregate([
                { $group: { _id: null, sum: { $sum: "$debt" } } },
            ]);

            const balanceDoc = await Counter.findOne({ key: "balance" }).lean();

            return res.json({
                ok: true,
                data: {
                    cards: {
                        soldTotal: saleAgg[0]?.soldTotal || 0,
                        salePaid: saleAgg[0]?.salePaid || 0,
                        expenseSum: expenseAgg[0]?.sum || 0,
                        customerDebt: customerDebtAgg[0]?.sum || 0,
                        supplierDebt: supplierDebtAgg[0]?.sum || 0,
                        balance: balanceDoc?.value || 0,
                    },
                },
            });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 📋 ACTIVITY (sales + expenses)
    // GET /api/webapp/dashboard/activity?from=ISO&to=ISO
    // =========================
    r.get("/dashboard/activity", async (req, res) => {
        try {
            const { from, to } = getRangeFromQuery(req);
            const dateMatch = { createdAt: { $gte: from, $lte: to } };

            const sales = await Sale.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();
            const expenses = await Expense.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();

            return res.json({ ok: true, data: { sales, expenses } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 📈 CHART (today vs yesterday hourly paidTotal)
    // GET /api/webapp/dashboard/chart
    // =========================
    r.get("/dashboard/chart", async (req, res) => {
        try {
            const zone = TZ || "Asia/Tashkent";

            const todayStart = moment().tz(zone).startOf("day").toDate();
            const todayEnd = moment().tz(zone).endOf("day").toDate();

            const yStart = moment().tz(zone).subtract(1, "day").startOf("day").toDate();
            const yEnd = moment().tz(zone).subtract(1, "day").endOf("day").toDate();

            const agg = async (from, to) => {
                const rows = await Sale.aggregate([
                    { $match: { createdAt: { $gte: from, $lte: to } } },
                    { $group: { _id: { $hour: "$createdAt" }, sum: { $sum: "$paidTotal" } } },
                    { $sort: { _id: 1 } },
                ]);

                const map = new Map(rows.map((x) => [x._id, x.sum]));
                const out = [];
                for (let h = 0; h < 24; h++) out.push({ hour: String(h).padStart(2, "0"), value: map.get(h) || 0 });
                return out;
            };

            const today = await agg(todayStart, todayEnd);
            const yesterday = await agg(yStart, yEnd);

            return res.json({ ok: true, data: { today, yesterday } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 🧾 RECEIPT + QR (public token bilan)
    // GET /api/webapp/receipt?token=XXXX
    // =========================
    r.get("/receipt", async (req, res) => {
        try {
            const token = req.query.token;
            if (!token) return res.status(400).json({ ok: false, error: "token required" });

            const doc = await ReceiptToken.findOne({ token }).lean();
            if (!doc) return res.status(404).json({ ok: false, error: "not found" });

            const sale = await Sale.findById(doc.saleId).lean();
            if (!sale) return res.status(404).json({ ok: false, error: "sale not found" });

            let deepLink = null;
            let qrDataUrl = null;

            if (CUSTOMER_BOT_USERNAME) {
                deepLink = `https://t.me/${CUSTOMER_BOT_USERNAME}?start=${token}`;
                const pngBuffer = await makeQrPngBuffer(deepLink);
                qrDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
            }

            return res.json({
                ok: true,
                data: {
                    sale,
                    scansCount: doc.scansCount || 0,
                    minPaid: MIN_QR_PAID,
                    deepLink,
                    qrDataUrl,
                },
            });
        } catch (e) {
            console.error("receipt error:", e);
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 👤 CUSTOMER ROUTES (Telegram WebApp verify) — ALohida
    // /api/webapp/customer/*
    // =========================
    const customer = express.Router();

    // 🔥 eng muhim: customer bot token bilan verify
    customer.use(verifyTgWebApp(customerBotToken));

    customer.get("/me", async (req, res) => {
        try {
            const tgUser = req.tgUser;
            if (!tgUser) return res.status(401).json({ ok: false, error: "NO_TG_USER" });

            const doc = await Customer.findOneAndUpdate(
                { tgId: tgUser.id },
                {
                    $set: {
                        tgName: tgUser.first_name || tgUser.username || "",
                        updatedAt: new Date(),
                    },
                },
                { new: true, upsert: true }
            ).lean();

            return res.json({ ok: true, data: { customer: doc } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    customer.get("/history", async (req, res) => {
        try {
            const tgUser = req.tgUser;
            if (!tgUser) return res.status(401).json({ ok: false, error: "NO_TG_USER" });

            const list = await ReceiptToken.find({
                redeemedByTgId: tgUser.id,
                status: "REDEEMED",
            }).sort({ redeemedAt: -1 }).limit(50).lean();

            return res.json({ ok: true, data: { list } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    customer.get("/ref/stats", async (req, res) => {
        try {
            const tgUser = req.tgUser;
            if (!tgUser) return res.status(401).json({ ok: false, error: "NO_TG_USER" });

            const count = await Referral.countDocuments({ inviterTgId: tgUser.id });
            const pointsFromInvites = Math.floor(count / 3);
            const leftToNext = 3 - (count % 3 || 3);

            return res.json({ ok: true, ref: { count, pointsFromInvites, leftToNext } });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });


    r.use("/customer", customer);

    return r;
}

module.exports = { webappRoutes };
