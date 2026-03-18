const Debt = require("../models/Debt");
const Counter = require("../models/Counter");
const { mongoose } = require("../db");

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;

    const created = await Counter.create(
        [{ key: "balance", value: 0 }],
        session ? { session } : undefined
    );

    return created[0];
}

async function addBalance(amount, session) {
    const bal = await ensureBalance(session);
    bal.value += Number(amount || 0);
    await bal.save({ session });
    return bal.value;
}

async function payDebt({ debtId, amount, payer }, { useTx = true } = {}) {
    const session = useTx ? await mongoose.startSession() : null;

    const run = async () => {
        const debt = await Debt.findById(debtId).session(session || null);

        if (!debt) throw new Error("Qarz topilmadi");
        if (debt.isClosed) throw new Error("Bu qarz yopilgan");

        const pay = Math.max(0, Number(amount || 0));
        if (!pay) throw new Error("To'lov summasi noto'g'ri");

        if (!payer || !payer.tgId || !payer.tgName) {
            throw new Error("To'lovchi ma'lumoti topilmadi");
        }

        const actualPay = Math.min(pay, Number(debt.remainingDebt || 0));

        // eng xavfsiz usul
        const currentPayments = Array.isArray(debt.payments) ? debt.payments : [];

        currentPayments.push({
            amount: actualPay,
            paidAt: new Date(),
            payer: {
                tgId: payer.tgId,
                tgName: payer.tgName
            },
            note: ""
        });

        debt.payments = currentPayments;
        debt.markModified("payments");

        debt.remainingDebt = Math.max(0, Number(debt.remainingDebt || 0) - actualPay);

        if (debt.remainingDebt <= 0) {
            debt.remainingDebt = 0;
            debt.isClosed = true;
        }

        await debt.save({ session });
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
    } finally {
        if (session) await session.endSession();
    }
}

module.exports = { payDebt };