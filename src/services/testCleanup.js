// src/services/testCleanup.js
// TEST filial (dasturchi) ma'lumotlarini avtomatik tozalaydi.
//  • branchId:"test" yozuvlari TEST_DATA_TTL_MIN (default 60 daqiqa) dan keyin o'chadi
//  • TEST balans hammasi tozalangach boshlang'ich qiymatga (TEST_START_BALANCE) qaytadi
//  • Haqiqiy filiallarga (sang/toda/eski branchId'siz yozuvlar) HECH QACHON tegmaydi — faqat branchId === "test"

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Purchase = require("../models/Purchase");
const ReceiptToken = require("../models/ReceiptToken");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");
const { getBranches, balanceKey, TEST_BRANCH } = require("./branches");

const SWEEP_MS = 5 * 60 * 1000;

function ttlMs() { return Math.max(1, Number(process.env.TEST_DATA_TTL_MIN || 60)) * 60 * 1000; }
function startBalance() { return Number(process.env.TEST_START_BALANCE || 10000000); }
const T = { branchId: TEST_BRANCH };   // QAT'IY filtr: faqat "test"

async function ensureTestBalance() {
    await Counter.updateOne(
        { key: balanceKey(TEST_BRANCH) },
        { $setOnInsert: { key: balanceKey(TEST_BRANCH), value: startBalance() } },
        { upsert: true }
    );
}

async function sweepTestData() {
    if (!getBranches().test) return null;
    const before = new Date(Date.now() - ttlMs());
    const r = {};

    r.sales    = (await Sale.deleteMany({ ...T, createdAt: { $lt: before } })).deletedCount;
    r.expenses = (await Expense.deleteMany({ ...T, createdAt: { $lt: before } })).deletedCount;
    r.debts    = (await Debt.deleteMany({ ...T, createdAt: { $lt: before } })).deletedCount;
    r.purchases = (await Purchase.deleteMany({ ...T, createdAt: { $lt: before } })).deletedCount;
    r.receipts = (await ReceiptToken.deleteMany({ ...T, createdAt: { $lt: before } })).deletedCount;

    const left = (await Promise.all([
        Sale.countDocuments(T), Expense.countDocuments(T),
        Debt.countDocuments(T), Purchase.countDocuments(T),
    ])).reduce((a, n) => a + n, 0);

    if (left === 0) {
        // Firmalardagi TEST qarzini jami qarzdan ayiramiz
        const sups = await Supplier.find({ "branchDebts.test": { $gt: 0 } });
        for (const s of sups) {
            const t = Number(s.branchDebts?.test || 0);
            s.debt = Math.max(0, Number(s.debt || 0) - t);
            const bd = { ...(s.branchDebts || {}) }; delete bd.test;
            s.branchDebts = bd;
            if (s.markModified) s.markModified("branchDebts");
            await s.save();
        }
        // TEST balansini boshlang'ichga qaytaramiz
        await Counter.updateOne(
            { key: balanceKey(TEST_BRANCH) },
            { $set: { value: startBalance() } },
            { upsert: true }
        );
    }
    return r;
}

let _timer = null;
function scheduleTestCleanup() {
    if (_timer || !getBranches().test) return;
    ensureTestBalance().catch(e => console.error("[test] balance init:", e?.message));
    const run = () => sweepTestData()
        .then(r => { if (r && Object.values(r).some(Boolean)) console.log("[test] tozalandi:", r); })
        .catch(e => console.error("[test] cleanup:", e?.message));
    run();
    _timer = setInterval(run, SWEEP_MS);
    if (_timer.unref) _timer.unref();
    console.log(`🧪 TEST filial yoqilgan: ma'lumot ${ttlMs() / 60000} daqiqadan keyin tozalanadi`);
}

module.exports = { scheduleTestCleanup, sweepTestData, ensureTestBalance };
