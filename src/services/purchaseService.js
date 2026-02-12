// src/services/purchaseService.js
const Purchase = require("../models/Purchase");
const Supplier = require("../models/Supplier");
const { nextOrderNo } = require("./orderNo");
const { mongoose } = require("../db");

function toNumber(v) {
    const n = parseInt(String(v || "").replace(/[^\d]/g, ""), 10) || 0;
    return Math.max(0, n);
}

async function createPurchase({ supplierId, totalCost, paid = 0, description = "", createdBy }) {
    const session = await mongoose.startSession();
    try {
        let out;
        await session.withTransaction(async () => {
            const sup = await Supplier.findById(supplierId).session(session);
            if (!sup) throw new Error("Firma topilmadi");

            const cost = toNumber(totalCost);
            const pay = Math.min(toNumber(paid), cost);
            const remaining = cost - pay;

            const orderNo = await nextOrderNo(session);

            const p = (await Purchase.create([{
                orderNo,
                supplierId: sup._id,
                supplierName: sup.name,
                totalCost: cost,
                paid: pay,
                remaining,
                description: String(description || "").trim(),
                isClosed: remaining === 0,
                createdBy
            }], { session }))[0];

            out = p;
        });
        return out;
    } finally {
        try { session.endSession(); } catch { }
    }
}

// FIFO: eng eski purchase.remaining dan boshlab yopadi
async function paySupplierFIFO({ supplierId, amount }) {
    const session = await mongoose.startSession();
    try {
        let out;
        await session.withTransaction(async () => {
            const sup = await Supplier.findById(supplierId).session(session);
            if (!sup) throw new Error("Firma topilmadi");

            let payLeft = toNumber(amount);
            if (!payLeft) throw new Error("To‘lov summasi noto‘g‘ri");

            const purchases = await Purchase.find({
                supplierId,
                isClosed: false,
                remaining: { $gt: 0 }
            }).sort({ createdAt: 1 }).session(session);

            let used = 0;

            for (const p of purchases) {
                if (payLeft <= 0) break;
                const take = Math.min(payLeft, p.remaining);
                p.paid += take;
                p.remaining -= take;
                if (p.remaining <= 0) {
                    p.remaining = 0;
                    p.isClosed = true;
                }
                await p.save({ session });
                used += take;
                payLeft -= take;
            }

            const remainingDebt = await Purchase.aggregate([
                { $match: { supplierId: sup._id, isClosed: false, remaining: { $gt: 0 } } },
                { $group: { _id: null, sum: { $sum: "$remaining" } } }
            ]);

            out = {
                supplierName: sup.name,
                usedAmount: used,
                notUsedAmount: payLeft, // agar qarz kam bo‘lsa ortib qoladi
                remainingDebt: remainingDebt[0]?.sum || 0
            };
        });
        return out;
    } finally {
        try { session.endSession(); } catch { }
    }
}

async function supplierDebtSummary(supplierId) {
    const sup = await Supplier.findById(supplierId);
    if (!sup) throw new Error("Firma topilmadi");

    const sum = await Purchase.aggregate([
        { $match: { supplierId: sup._id, isClosed: false, remaining: { $gt: 0 } } },
        { $group: { _id: null, remaining: { $sum: "$remaining" } } }
    ]);

    return { supplier: sup, remaining: sum[0]?.remaining || 0 };
}

module.exports = { createPurchase, paySupplierFIFO, supplierDebtSummary };
