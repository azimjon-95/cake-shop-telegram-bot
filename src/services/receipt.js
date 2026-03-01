// src/services/receipt.js
const crypto = require("crypto");
const ReceiptToken = require("../models/ReceiptToken");
const Customer = require("../models/Customer");
const Sale = require("../models/Sale");

function genToken() {
    return crypto.randomBytes(16).toString("hex");
}

// ✅ 70 000 dan oshsa token yaratadi (sale uchun 1 marta)
async function createReceiptTokenIfNeeded({ sale, minPaid = 70000 }) {
    if (!sale || Number(sale.paidTotal || 0) < minPaid) return null;

    const existed = await ReceiptToken.findOne({ saleId: sale._id });
    if (existed) return existed;

    const token = genToken();
    return ReceiptToken.create({
        token,
        saleId: sale._id,
        orderNo: sale.orderNo,
        minPaid,
        saleTotal: Number(sale.total || 0),
        salePaid: Number(sale.paidTotal || 0),

        // ✅ odno-razoviy
        status: "NEW",
        redeemedAt: null,
        redeemedByTgId: null,
        scansCount: 0,
        lastScanAt: null,
    });
}

// ✅ ODNO-RAZOVIY: 1 marta ishlaydi va 1 ball beradi
async function redeemReceiptToken({ token, tgUser }) {
    const doc = await ReceiptToken.findOne({ token });
    if (!doc) return { ok: false, code: "NOT_FOUND" };

    // 🔴 ishlatilgan bo‘lsa
    if (doc.status === "REDEEMED") {
        return { ok: false, code: "ALREADY_USED" };
    }

    // sale kerak bo‘lishi mumkin (chek ko‘rsatish uchun)
    const sale = await Sale.findById(doc.saleId).lean();
    if (!sale) return { ok: false, code: "SALE_MISSING" };

    // ✅ tokenni yopamiz
    doc.status = "REDEEMED";
    doc.redeemedByTgId = tgUser.id;
    doc.redeemedAt = new Date();
    doc.scansCount = 1;
    doc.lastScanAt = new Date();
    doc.salePaid = Number(sale.paidTotal || 0);
    doc.saleTotal = Number(sale.total || 0);
    const paidTotal = Number(sale.paidTotal || 0);
    const bonusPoints = Math.floor(paidTotal * 0.10);
    await doc.save();

    // ✅ customer create/update +1 ball
    const customer = await Customer.findOneAndUpdate(
        { tgId: tgUser.id },
        {
            $set: {
                tgName:
                    [tgUser.first_name, tgUser.last_name]
                        .filter(Boolean)
                        .join(" ")
                        .trim() ||
                    tgUser.username ||
                    "",
                updatedAt: new Date(),
            },
            $inc: { points: bonusPoints },
        },
        { new: true, upsert: true }
    ).lean();

    // (ixtiyoriy) realtime push qilish
    if (global.realtime?.publish) {
        global.realtime.publish({
            type: "customer_point",
            tgId: tgUser.id,
            points: customer.points,
            bonusAdded: bonusPoints,
            saleOrderNo: sale.orderNo,
            at: Date.now(),
        });
    }

    return { ok: true, sale, customer, tokenDoc: doc.toObject(), bonusAdded: bonusPoints };
}

module.exports = { createReceiptTokenIfNeeded, redeemReceiptToken };

