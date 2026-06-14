// src/routes/webapp.js
const express = require("express");
const moment = require("moment-timezone");

const { makeQrPngBuffer } = require("../services/qr");
const { CUSTOMER_BOT_USERNAME, MIN_QR_PAID, TZ, CUSTOMER_BOT_TOKEN, BOT_TOKEN } = require("../config");
const Referral = require("../models/Referral");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");

const ReceiptToken = require("../models/ReceiptToken");
const Customer = require("../models/Customer");

const { verifyTgWebApp } = require("../middlewares/verifyTgWebApp");
const { allowWebAppUsers } = require("../middlewares/allowWebAppUsers");
const { saveSaleWithTx } = require("../logic/storage");
const { saveExpenseWithTx } = require("../logic/storage");
const Worker = require("../models/Worker");
const { ADMIN_TG_ID } = require("../config");

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

    // admin webapp uchun
    r.use("/dashboard", verifyTgWebApp(BOT_TOKEN), allowWebAppUsers);

    // =========================
    // 📊 SUMMARY (cards)
    // GET /api/webapp/dashboard/summary?from=ISO&to=ISO
    // =========================
    r.get("/dashboard/summary", async (req, res) => {
        try {
            const { from, to } = getRangeFromQuery(req);
            const dateMatch = { createdAt: { $gte: from, $lte: to } };

            // ✅ 5 ta so'rovni parallel yuboramiz — ketma-ket emas
            const [saleAgg, expenseAgg, customerDebtAgg, supplierDebtAgg, balanceDoc] = await Promise.all([
                Sale.aggregate([
                    { $match: dateMatch },
                    { $group: { _id: null, soldTotal: { $sum: "$total" }, salePaid: { $sum: "$paidTotal" } } },
                ]),
                Expense.aggregate([
                    { $match: dateMatch },
                    { $group: { _id: null, sum: { $sum: "$amount" } } },
                ]),
                Debt.aggregate([
                    { $match: { isClosed: false, kind: "customer" } },
                    { $group: { _id: null, sum: { $sum: "$remainingDebt" } } },
                ]),
                Supplier.aggregate([
                    { $group: { _id: null, sum: { $sum: "$debt" } } },
                ]),
                Counter.findOne({ key: "balance" }).lean(),
            ]);

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



    // =========================
    // 🏓 PING — offline aniqlash uchun
    // HEAD /api/webapp/ping
    // =========================
    r.head("/ping", (req, res) => res.sendStatus(200));
    r.get("/ping",  (req, res) => res.json({ ok: true, ts: Date.now() }));

    // =========================
    // 💾 OFFLINE SALE — internet qaytganda sync
    // POST /api/webapp/offline/sale
    // Body: { items, paidTotal, total, debtTotal, offlineNote, offlineId }
    // =========================
    r.post("/offline/sale", verifyTgWebApp(BOT_TOKEN), allowWebAppUsers, async (req, res) => {
        try {
            const { items, paidTotal, total, debtTotal, offlineNote, offlineId } = req.body;
            const seller = {
                tgId: req.tgUser?.id,
                tgName: req.tgUser?.first_name || req.worker?.fullName || "Offline"
            };

            if (!items?.length) return res.status(400).json({ ok: false, error: "items required" });

            const result = await saveSaleWithTx({
                seller,
                items,
                phone: null,
                noteText: offlineNote || ""
            });

            // Socket event
            if (global.io) global.io.emit("refresh");

            return res.json({
                ok: true,
                data: {
                    sale: result.sale,
                    offlineId,          // client o'z id sini qaytarib oladi
                    serverOrderNo: result.sale.orderNo
                }
            });
        } catch (e) {
            console.error("[offline/sale]", e.message);
            if (String(e.message).startsWith("BALANCE_LOW:")) {
                return res.status(402).json({ ok: false, error: "BALANCE_LOW", balance: Number(e.message.split(":")[1] || 0) });
            }
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 💾 OFFLINE EXPENSE — internet qaytganda sync
    // POST /api/webapp/offline/expense
    // Body: { title, amount, categoryKey, offlineNote, offlineId }
    // =========================
    r.post("/offline/expense", verifyTgWebApp(BOT_TOKEN), allowWebAppUsers, async (req, res) => {
        try {
            const { title, amount, categoryKey, offlineNote, offlineId } = req.body;
            const spender = {
                tgId: req.tgUser?.id,
                tgName: req.tgUser?.first_name || req.worker?.fullName || "Offline"
            };

            if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "amount required" });

            const exp = await saveExpenseWithTx({
                spender,
                title: title || categoryKey || "Chiqim",
                amount: Number(amount),
                categoryKey: categoryKey || "other",
                description: offlineNote || ""
            });

            if (global.io) global.io.emit("refresh");

            return res.json({ ok: true, data: { expense: exp, offlineId } });
        } catch (e) {
            console.error("[offline/expense]", e.message);
            if (String(e.message).startsWith("BALANCE_LOW:")) {
                return res.status(402).json({ ok: false, error: "BALANCE_LOW", balance: Number(e.message.split(":")[1] || 0) });
            }
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    // =========================
    // 📦 OFFLINE BATCH SYNC — bir vaqtda ko'p item
    // POST /api/webapp/offline/sync
    // Body: { items: [ {type:"sale"|"expense", payload, offlineId} ] }
    // =========================
    r.post("/offline/sync", verifyTgWebApp(BOT_TOKEN), allowWebAppUsers, async (req, res) => {
        const { items } = req.body;
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ ok: false, error: "items array required" });
        }

        const results = [];
        for (const item of items.slice(0, 50)) { // max 50 ta
            try {
                let result;
                const seller = {
                    tgId: req.tgUser?.id,
                    tgName: req.tgUser?.first_name || req.worker?.fullName || "Offline"
                };

                if (item.type === "sale") {
                    const r = await saveSaleWithTx({
                        seller,
                        items: item.payload.items || [],
                        phone: item.payload.phone || null,
                        noteText: item.payload.offlineNote || ""
                    });
                    result = { ok: true, offlineId: item.offlineId, orderNo: r.sale.orderNo };
                } else if (item.type === "expense") {
                    const e = await saveExpenseWithTx({
                        spender: seller,
                        title: item.payload.title || "Chiqim",
                        amount: Number(item.payload.amount || 0),
                        categoryKey: item.payload.categoryKey || "other",
                        description: item.payload.offlineNote || ""
                    });
                    result = { ok: true, offlineId: item.offlineId, orderNo: e.orderNo };
                } else {
                    result = { ok: false, offlineId: item.offlineId, error: "unknown type" };
                }
                results.push(result);
            } catch (e) {
                results.push({ ok: false, offlineId: item.offlineId, error: e.message });
            }
            // Har bir item orasida 50ms — DB overload oldini olish
            await new Promise(r => setTimeout(r, 50));
        }

        if (global.io) global.io.emit("refresh");

        return res.json({ ok: true, results });
    });

    // =========================
    // 🏥 HEALTH — server va DB holati
    // GET /api/webapp/health
    // =========================
    r.get("/health", async (req, res) => {
        try {
            const { mongoose } = require("../db");
            const dbState = mongoose.connection.readyState; // 1=connected
            return res.json({ ok: true, db: dbState === 1 ? "connected" : "disconnected", ts: Date.now() });
        } catch {
            return res.json({ ok: false, ts: Date.now() });
        }
    });

    r.use("/customer", customer);

    return r;
}

module.exports = { webappRoutes };
