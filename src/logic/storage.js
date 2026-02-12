// src/logic/storage.js
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Counter = require("../models/Counter");
const { mongoose } = require("../db");
const { nextOrderNo } = require("../services/orderNo");

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;
    const created = await Counter.create([{ key: "balance", value: 0 }], session ? { session } : undefined);
    return created[0];
}

// ✅ session ham qabul qiladi
async function addBalance(delta, session) {
    const opts = { new: true, upsert: true };
    if (session) opts.session = session;

    const doc = await Counter.findOneAndUpdate(
        { key: "balance" },
        { $inc: { value: delta } },
        opts
    );

    return doc.value;
}

// ✅ QAYTIM/DEBT/PAYED ni to‘g‘ri hisoblaydi (DB ga change yozilmaydi)
function calcSaleTotals(items) {
    let total = 0;       // jami savdo
    let paidGiven = 0;   // mijoz yozgan haqiqiy to‘lovlar yig‘indisi (ortiqchasi ham shu yerda)
    for (const it of items) {
        const qty = Math.max(1, Number(it.qty || 1));
        const price = Math.max(0, Number(it.price || 0));
        const lineTotal = qty * price;
        total += lineTotal;

        // paid bo‘lmasa -> to‘liq to‘langan deb olamiz
        // paid bo‘lsa -> aynan shu qiymatni qo‘shamiz (0 ham bo‘lishi mumkin)
        const paid = (it.paid === null || it.paid === undefined)
            ? lineTotal
            : Math.max(0, Number(it.paid || 0));

        paidGiven += paid;
    }

    // ✅ kassaga kiradigan real tushum: jami summadan oshmasin
    const paidTotal = Math.min(paidGiven, total);

    // ✅ qarz: jami - mijoz bergani (agar kam bo‘lsa)
    const debtTotal = Math.max(0, total - paidGiven);

    // ✅ qaytim: mijoz bergani - jami (agar ortiqcha bo‘lsa)
    const change = Math.max(0, paidGiven - total);

    return { total, paidGiven, paidTotal, debtTotal, change };
}

async function saveSaleWithTx({ seller, items, phone, noteText }) {
    const session = await mongoose.startSession();

    const run = async () => {
        const { total, paidTotal, debtTotal, change } = calcSaleTotals(items);
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

        // ✅ kassa faqat paidTotal ga oshadi (ortiqcha qaytim DB ga kirmaydi)
        await addBalance(paidTotal, session);

        let debtDoc = null;
        if (debtTotal > 0) {
            debtDoc = (await Debt.create([{
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

        // ✅ change faqat return (DB ga yozilmaydi)
        return { sale, debtDoc, change };
    };

    try {
        let out;
        await session.withTransaction(async () => {
            out = await run();
        });
        return out;
    } finally {
        try { session.endSession(); } catch { }
    }
}

async function saveExpenseWithTx({ spender, title, amount }) {
    const session = await mongoose.startSession();

    const run = async () => {
        const orderNo = await nextOrderNo(session);

        const exp = (await Expense.create([{
            orderNo,
            spender,
            title,
            amount
        }], { session }))[0];

        await addBalance(-amount, session);
        return exp;
    };

    try {
        let out;
        await session.withTransaction(async () => {
            out = await run();
        });
        return out;
    } finally {
        try { session.endSession(); } catch { }
    }
}

module.exports = { addBalance, ensureBalance, saveSaleWithTx, saveExpenseWithTx };
