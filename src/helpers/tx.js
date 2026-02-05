// src/bot/helpers/tx.js
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const { mongoose } = require("../db");

const { nextOrderNo } = require("../services/orderNo");
const { ensureBalance, addBalance } = require("./balance");
const { itemsToText } = require("./text");

async function saveSaleWithTx({ seller, items, phone }) {
    const session = await mongoose.startSession();

    const calc = () => {
        let total = 0;
        let paidTotal = 0;

        for (const it of items) {
            const itemTotal = it.qty * it.price;
            total += itemTotal;

            if (it.paid != null) paidTotal += Math.min(it.paid, itemTotal);
            else paidTotal += itemTotal;
        }

        const debtTotal = Math.max(0, total - paidTotal);
        return { total, paidTotal, debtTotal };
    };

    const run = async () => {
        const { total, paidTotal, debtTotal } = calc();
        const orderNo = await nextOrderNo(session);

        const sale = (await Sale.create([{
            orderNo,
            seller,
            phone: phone || null,
            items,
            total,
            paidTotal,
            debtTotal
        }], { session }))[0];

        await addBalance(paidTotal, session);

        let debtDoc = null;
        if (debtTotal > 0) {
            debtDoc = (await Debt.create([{
                saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal,
                remainingDebt: debtTotal,
                seller,
                note: itemsToText(items),
                isClosed: false,
                payments: []
            }], { session }))[0];
        }

        return { sale, debtDoc };
    };

    try {
        let out;
        await session.withTransaction(async () => { out = await run(); });
        return out;
    } catch (e) {
        // fallback (txsiz)
        const { total, paidTotal, debtTotal } = calc();
        const orderNo = await nextOrderNo(null);

        const sale = await Sale.create({
            orderNo, seller, phone: phone || null, items, total, paidTotal, debtTotal
        });

        await addBalance(paidTotal, null);

        let debtDoc = null;
        if (debtTotal > 0) {
            debtDoc = await Debt.create({
                saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal,
                remainingDebt: debtTotal,
                seller,
                note: itemsToText(items),
                isClosed: false,
                payments: []
            });
        }
        return { sale, debtDoc };
    } finally {
        try { session.endSession(); } catch { }
    }
}

async function saveExpenseWithTx({ spender, title, amount }) {
    const session = await mongoose.startSession();

    const run = async () => {
        const orderNo = await nextOrderNo(session);

        const exp = (await Expense.create([{
            orderNo, spender, title, amount
        }], { session }))[0];

        await addBalance(-amount, session);
        return exp;
    };

    try {
        let out;
        await session.withTransaction(async () => { out = await run(); });
        return out;
    } catch (e) {
        const orderNo = await nextOrderNo(null);
        const exp = await Expense.create({ orderNo, spender, title, amount });

        // bu yerda session emas, null bo‘lishi kerak
        await addBalance(-amount, null);
        return exp;
    } finally {
        try { session.endSession(); } catch { }
    }
}

module.exports = { saveSaleWithTx, saveExpenseWithTx, ensureBalance };
