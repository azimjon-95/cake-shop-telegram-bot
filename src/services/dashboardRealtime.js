// src/services/dashboardRealtime.js
const moment = require("moment-timezone");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");

function roomKey(fromISO, toISO) {
    return `dash:${fromISO}:${toISO}`;
}

async function buildDashboardData(fromISO, toISO) {
    const from = new Date(fromISO);
    const to = new Date(toISO);

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

    const sales = await Sale.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();
    const expenses = await Expense.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();

    // chart (hourly)
    const aggHourly = async (fromD, toD) => {
        const rows = await Sale.aggregate([
            { $match: { createdAt: { $gte: fromD, $lte: toD } } },
            { $group: { _id: { $hour: "$createdAt" }, sum: { $sum: "$paidTotal" } } },
            { $sort: { _id: 1 } },
        ]);

        const map = new Map(rows.map((x) => [x._id, x.sum]));
        const out = [];
        for (let h = 0; h < 24; h++) {
            out.push({ hour: String(h).padStart(2, "0"), value: map.get(h) || 0 });
        }
        return out;
    };

    // today/yesterday (server TZ bo‘yicha)
    const todayStart = moment().startOf("day").toDate();
    const todayEnd = moment().endOf("day").toDate();
    const yStart = moment().subtract(1, "day").startOf("day").toDate();
    const yEnd = moment().subtract(1, "day").endOf("day").toDate();

    const today = await aggHourly(todayStart, todayEnd);
    const yesterday = await aggHourly(yStart, yEnd);

    return {
        cards: {
            soldTotal: saleAgg[0]?.soldTotal || 0,
            salePaid: saleAgg[0]?.salePaid || 0,
            expenseSum: expenseAgg[0]?.sum || 0,
            customerDebt: customerDebtAgg[0]?.sum || 0,
            supplierDebt: supplierDebtAgg[0]?.sum || 0,
            balance: balanceDoc?.value || 0,
        },
        activity: { sales, expenses },
        chart: { today, yesterday },
        meta: { fromISO, toISO, ts: Date.now() },
    };
}

function createDashboardRealtime({ io, intervalMs = 2500 }) {
    // room -> { timer, lastHash, lastPayload, subsCount }
    const rooms = new Map();

    async function tickRoom(key) {
        const st = rooms.get(key);
        if (!st) return;

        try {
            const payload = await buildDashboardData(st.fromISO, st.toISO);
            const hash = JSON.stringify(payload); // kichik loyihalarda yetadi

            if (hash !== st.lastHash) {
                st.lastHash = hash;
                st.lastPayload = payload;
                io.to(key).emit("dashboard:update", payload);
            }
        } catch (e) {
            io.to(key).emit("dashboard:error", { message: e?.message || "DASH_ERROR" });
        }
    }

    function ensureRoom(fromISO, toISO) {
        const key = roomKey(fromISO, toISO);
        if (rooms.has(key)) return key;

        const timer = setInterval(() => tickRoom(key), intervalMs);
        rooms.set(key, {
            key,
            fromISO,
            toISO,
            timer,
            lastHash: "",
            lastPayload: null,
            subsCount: 0,
        });
        return key;
    }

    function cleanupRoom(key) {
        const st = rooms.get(key);
        if (!st) return;
        clearInterval(st.timer);
        rooms.delete(key);
    }

    function attachSocketHandlers() {
        io.on("connection", (socket) => {
            socket.on("dashboard:subscribe", async ({ fromISO, toISO }) => {
                if (!fromISO || !toISO) {
                    socket.emit("dashboard:error", { message: "fromISO/toISO required" });
                    return;
                }

                // old roomdan chiq
                if (socket.data.dashRoom) {
                    socket.leave(socket.data.dashRoom);
                    const old = rooms.get(socket.data.dashRoom);
                    if (old) {
                        old.subsCount = Math.max(0, old.subsCount - 1);
                        if (old.subsCount === 0) cleanupRoom(old.key);
                    }
                }

                // new room
                const key = ensureRoom(fromISO, toISO);
                socket.data.dashRoom = key;
                socket.join(key);

                const st = rooms.get(key);
                if (st) st.subsCount += 1;

                // darhol initial yuboramiz
                try {
                    const payload = await buildDashboardData(fromISO, toISO);
                    st.lastHash = JSON.stringify(payload);
                    st.lastPayload = payload;
                    socket.emit("dashboard:update", payload);
                } catch (e) {
                    socket.emit("dashboard:error", { message: e?.message || "DASH_ERROR" });
                }
            });

            socket.on("disconnect", () => {
                const key = socket.data.dashRoom;
                if (!key) return;
                const st = rooms.get(key);
                if (st) {
                    st.subsCount = Math.max(0, st.subsCount - 1);
                    if (st.subsCount === 0) cleanupRoom(key);
                }
            });
        });
    }

    return { attachSocketHandlers };
}

module.exports = { createDashboardRealtime };