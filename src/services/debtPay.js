const Debt = require("../models/Debt");
const Counter = require("../models/Counter");
const { mongoose } = require("../db");

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;
    const created = await Counter.create([{ key: "balance", value: 0 }], session ? { session } : undefined);
    return created[0];
}

async function addBalance(amount, session) {
    const bal = await ensureBalance(session);
    bal.value += amount;
    await bal.save({ session });
    return bal.value;
}

async function payDebt({ debtId, amount, payer }, { useTx = true } = {}) {
    const session = useTx ? await mongoose.startSession() : null;

    const run = async () => {
        const debt = await Debt.findById(debtId).session(session || null);
        if (!debt) throw new Error("Qarz topilmadi");
        if (debt.isClosed) throw new Error("Bu qarz yopilgan");

        const pay = Math.max(0, amount);
        if (!pay) throw new Error("To'lov summasi noto'g'ri");

        const actualPay = Math.min(pay, debt.remainingDebt);
        debt.remainingDebt -= actualPay;
        debt.payments.push({
            amount: actualPay,
            paidBy: payer
        });
        if (debt.remainingDebt <= 0) {
            debt.remainingDebt = 0;
            debt.isClosed = true;
        }
        await debt.save({ session });

        // Kassa + (real tushgan pul)
        await addBalance(actualPay, session);

        return { debt, actualPay };
    };

    try {
        if (session) {
            let out;
            await session.withTransaction(async () => {
                out = await run();
            });
            return out;
        }
        return await run();
    } catch (e) {
        // fallback (transaction bo‘lmasa)
        if (session) {
            session.endSession();
            return await payDebt({ debtId, amount, payer }, { useTx: false });
        }
        throw e;
    } finally {
        if (session) session.endSession();
    }
}

module.exports = { payDebt };
