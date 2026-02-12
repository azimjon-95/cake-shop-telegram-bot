// src/models/Debt.js
const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    tgId: { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    paidAt: { type: Date, default: Date.now },
    payer: { type: PersonSchema, required: true },
    note: { type: String, default: "" }
}, { _id: false });

const DebtSchema = new mongoose.Schema({
    kind: { type: String, enum: ["customer", "supplier"], default: "customer", index: true },

    // customer debt (old)
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", default: null },
    customerPhone: { type: String, default: null },

    // supplier debt (new)
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null, index: true },

    totalDebt: { type: Number, required: true, default: 0 },
    remainingDebt: { type: Number, required: true, default: 0 },

    note: { type: String, default: "" },
    seller: { type: PersonSchema, default: null }, // customer debt uchun qoladi
    isClosed: { type: Boolean, default: false },

    payments: { type: [PaymentSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model("Debt", DebtSchema);
