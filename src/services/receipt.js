// src/services/receipt.js
const crypto       = require("crypto");
const ReceiptToken = require("../models/ReceiptToken");
const Customer     = require("../models/Customer");
const Sale         = require("../models/Sale");

function genToken() {
    return crypto.randomBytes(16).toString("hex");
}

// ── Token yaratish (sotuv uchun 1 marta) ──────────────
async function createReceiptTokenIfNeeded({ sale, minPaid = 70000 }) {
    if (!sale || Number(sale.paidTotal || 0) < minPaid) return null;

    // Avval mavjudini qaytaramiz
    const existed = await ReceiptToken.findOne({ saleId: sale._id }).lean();
    if (existed) return existed;

    const token = genToken();
    return ReceiptToken.create({
        token,
        saleId:    sale._id,
        orderNo:   sale.orderNo,
        minPaid,
        saleTotal: Number(sale.total    || 0),
        salePaid:  Number(sale.paidTotal || 0),
        status:    "NEW",
        scansCount: 0,
    });
}

// ── Token ishlatiш (1 marta, QR skan) ────────────────
async function redeemReceiptToken({ token, tgUser }) {
    const doc = await ReceiptToken.findOne({ token });
    if (!doc) return { ok: false, code: "NOT_FOUND" };

    if (doc.status === "REDEEMED") {
        return { ok: false, code: "ALREADY_USED" };
    }

    const sale = await Sale.findById(doc.saleId).lean();
    if (!sale) return { ok: false, code: "SALE_MISSING" };

    const paidTotal   = Number(sale.paidTotal || 0);
    const bonusPoints = Math.floor(paidTotal * 0.10);

    // Token yopamiz
    doc.status          = "REDEEMED";
    doc.redeemedByTgId  = tgUser.id;
    doc.redeemedAt      = new Date();
    doc.scansCount      = 1;
    doc.lastScanAt      = new Date();
    doc.salePaid        = paidTotal;
    doc.saleTotal       = Number(sale.total || 0);
    await doc.save();

    // Customer ball qo'shamiz
    const tgName = [tgUser.first_name, tgUser.last_name]
        .filter(Boolean).join(" ").trim() || tgUser.username || "";

    const customer = await Customer.findOneAndUpdate(
        { tgId: tgUser.id },
        {
            $set:  { tgName, updatedAt: new Date() },
            $inc:  { points: bonusPoints },
        },
        { new: true, upsert: true }
    ).lean();

    // Realtime push
    if (global.realtime?.publish) {
        global.realtime.publish({
            type:         "customer_point",
            tgId:         tgUser.id,
            points:       customer.points,
            bonusAdded:   bonusPoints,
            saleOrderNo:  sale.orderNo,
            at:           Date.now(),
        });
    }

    return {
        ok:         true,
        sale,
        customer,
        bonusAdded: bonusPoints,
        tokenDoc:   { ...doc.toObject(), bonusAdded: bonusPoints },
    };
}

module.exports = { createReceiptTokenIfNeeded, redeemReceiptToken };
