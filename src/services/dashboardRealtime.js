// src/services/dashboardRealtime.js
const moment = require("moment-timezone");
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const { ALL, normBranch, withBranch } = require("./branches");
const { balanceFor, supplierDebtSum } = require("./branchData");

// branch: "all" | "sang" | "toda"   (default: all — eski xatti-harakat)
function cleanBranch(b) {
    const v = String(b || "").toLowerCase();
    return !v || v === ALL ? ALL : normBranch(v);
}

function roomKey(fromISO, toISO, branch = ALL) {
    return `dash:${cleanBranch(branch)}:${fromISO}:${toISO}`;
}

async function buildDashboardData(fromISO, toISO, branch = ALL) {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    branch = cleanBranch(branch);

    const dateMatch = withBranch({ createdAt: { $gte: from, $lte: to } }, branch);

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
        { $match: withBranch({ isClosed: false, kind: "customer" }, branch) },
        { $group: { _id: null, sum: { $sum: "$remainingDebt" } } },
    ]);

    const supplierDebtTotal = await supplierDebtSum(branch);
    const balanceTotal = await balanceFor(branch);

    const sales = await Sale.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();
    const expenses = await Expense.find(dateMatch).sort({ createdAt: -1 }).limit(30).lean();

    // chart (hourly)
    const aggHourly = async (fromD, toD) => {
        const rows = await Sale.aggregate([
            { $match: withBranch({ createdAt: { $gte: fromD, $lte: toD } }, branch) },
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
            supplierDebt: supplierDebtTotal || 0,
            balance: balanceTotal || 0,
        },
        activity: { sales, expenses },
        chart: { today, yesterday },
        meta: { fromISO, toISO, branch, ts: Date.now() },
    };
}

// ✅ Natijani 8 sekund cache qilamiz — MongoDB ga ortiqcha so'rov ketmaydi
const _cache = new Map(); // key -> { data, ts }
const CACHE_TTL = 8000;   // 8 sekund

async function buildDashboardDataCached(fromISO, toISO, branch = ALL) {
    const cacheKey = `${cleanBranch(branch)}|${fromISO}|${toISO}`;
    const cached = _cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
        return cached.data;
    }
    const data = await buildDashboardData(fromISO, toISO, branch);
    _cache.set(cacheKey, { data, ts: Date.now() });
    // 30 dan ortiq unique range bo'lsa eski cachelarni tozala
    if (_cache.size > 30) {
        const oldest = [..._cache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0];
        _cache.delete(oldest[0]);
    }
    return data;
}

function createDashboardRealtime({ io, intervalMs = 10000 }) {
    // room -> { timer, lastHash, lastPayload, subsCount }
    const rooms = new Map();

    async function tickRoom(key) {
        const st = rooms.get(key);
        if (!st) return;

        try {
            const payload = await buildDashboardDataCached(st.fromISO, st.toISO, st.branch);
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

    function ensureRoom(fromISO, toISO, branch) {
        const key = roomKey(fromISO, toISO, branch);
        if (rooms.has(key)) return key;

        const timer = setInterval(() => tickRoom(key), intervalMs);
        rooms.set(key, {
            key,
            fromISO,
            toISO,
            branch: cleanBranch(branch),
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
            socket.on("dashboard:subscribe", async ({ fromISO, toISO, branch }) => {
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
                const key = ensureRoom(fromISO, toISO, branch);
                socket.data.dashRoom = key;
                socket.join(key);

                const st = rooms.get(key);
                if (st) st.subsCount += 1;

                // darhol initial yuboramiz
                try {
                    const payload = await buildDashboardDataCached(fromISO, toISO, branch);
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