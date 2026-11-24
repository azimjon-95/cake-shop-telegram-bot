// src/logic/storage.js
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Counter = require("../models/Counter");
const { mongoose } = require("../db");
const { nextOrderNo } = require("../services/orderNo");
const { currentBranch, normBranch, balanceKey } = require("../services/branches");

// ✅ Balansni atomik o'zgartirish (session bilan yoki sessiyasiz)
// branchId berilmasa — joriy filial (Sang balansi eski "balance" kalitida)
async function addBalance(delta, session, branchId) {
    const opts = { new: true, upsert: true };
    if (session) opts.session = session;

    const doc = await Counter.findOneAndUpdate(
        { key: balanceKey(branchId || currentBranch()) },
        { $inc: { value: delta } },
        opts
    );
    return doc.value;
}

// ✅ Balansni olish (filial bo'yicha)
async function getBalance(session, branchId) {
    const doc = await Counter.findOne({ key: balanceKey(branchId || currentBranch()) }).session(session || null);
    return Number(doc?.value || 0);
}

// ✅ Savdo uchun totallar (qaytim va qarz ham)
function calcSaleTotals(items) {
    let total = 0;
    let paidGiven = 0;

    for (const it of items) {
        const qty = Math.max(1, Number(it.qty || 1));
        const price = Math.max(0, Number(it.price || 0));
        const lineTotal = qty * price;
        total += lineTotal;

        const paid = (it.paid === null || it.paid === undefined)
            ? lineTotal
            : Math.max(0, Number(it.paid || 0));
        paidGiven += paid;
    }

    const paidTotal = Math.min(paidGiven, total);
    const debtTotal = Math.max(0, total - paidGiven);
    const change = Math.max(0, paidGiven - total);

    return { total, paidGiven, paidTotal, debtTotal, change };
}

// ── Idempotentlik ────────────────────────────────────────
// Bir xil idemKey bilan ikkinchi yozuv: DUPLICATE_OPERATION (err.existing — avval saqlangan hujjat).
// Moliyaviy hisob (balans/qarz) faqat birinchi muvaffaqiyatli yozuvda o'zgaradi — tranzaksiya bekor bo'ladi.
function duplicateError(existing) {
    const e = new Error("DUPLICATE_OPERATION");
    e.code = "DUPLICATE_OPERATION";
    e.existing = existing || null;
    return e;
}
const isDupKey = (e) => e?.code === 11000 || /E11000/.test(String(e?.message || ""));

// ✅ Sotuv saqlash (tranzaksiya ichida)
async function saveSaleWithTx({ seller, items, phone, noteText, branchId, idemKey }) {
    const session = await mongoose.startSession();
    const branch = normBranch(branchId || currentBranch());

    const run = async () => {
        if (idemKey) {
            const prev = await Sale.findOne({ idemKey }).session(session).lean();
            if (prev) throw duplicateError(prev);
        }
        const { total, paidTotal, debtTotal, change } = calcSaleTotals(items);
        const orderNo = await nextOrderNo(session);

        const sale = (await Sale.create([{
            ...(idemKey ? { idemKey } : {}),
            orderNo,
            branchId: branch,
            seller,
            phone: phone || null,
            items,
            total,
            paidTotal,
            debtTotal
        }], { session }))[0];

        await addBalance(paidTotal, session, branch);

        let debtDoc = null;
        if (debtTotal > 0) {
            debtDoc = (await Debt.create([{
                branchId: branch,
                saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal,
                remainingDebt: debtTotal,
                seller,
                note: noteText,
                isClosed: false,
                payments: []
            }], { session }))[0];
        }

        return { sale, debtDoc, change };
    };

    try {
        let out;
        await session.withTransaction(async () => { out = await run(); });
        return out;
    } catch (e) {
        if (idemKey && isDupKey(e)) throw duplicateError(await Sale.findOne({ idemKey }).lean());
        throw e;
    } finally {
        try { session.endSession(); } catch { }
    }
}

// ✅ Chiqim saqlash — balans tekshiruvi bilan
// Agar balans yetmasa, error tashlaydi
async function saveExpenseWithTx({ spender, title, amount, categoryKey, description, branchId, idemKey }) {
    if (!amount || amount <= 0) throw new Error("Summa noto'g'ri");

    const session = await mongoose.startSession();
    const branch = normBranch(branchId || currentBranch());

    const run = async () => {
        if (idemKey) {
            const prev = await Expense.findOne({ idemKey }).session(session).lean();
            if (prev) throw duplicateError(prev);
        }
        // ✅ BALANS TEKSHIRUVI (shu filialning o'z balansi)
        const balance = await getBalance(session, branch);
        if (balance < amount) {
            throw new Error(`BALANCE_LOW:${balance}`);
        }

        const orderNo = await nextOrderNo(session);

        const expData = {
            orderNo,
            branchId: branch,
            spender,
            title: title || "Chiqim",
            amount
        };
        if (categoryKey) expData.categoryKey = categoryKey;
        if (description) expData.description = description;
        if (idemKey) expData.idemKey = idemKey;

        const exp = (await Expense.create([expData], { session }))[0];
        await addBalance(-amount, session, branch);
        return exp;
    };

    try {
        let out;
        await session.withTransaction(async () => { out = await run(); });
        return out;
    } catch (e) {
        if (idemKey && isDupKey(e)) throw duplicateError(await Expense.findOne({ idemKey }).lean());
        throw e;
    } finally {
        try { session.endSession(); } catch { }
    }
}

module.exports = { addBalance, getBalance, saveSaleWithTx, saveExpenseWithTx, isDupKey };
