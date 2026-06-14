// src/models/Debt.js
const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    tgId:   { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const PaymentSchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    paidAt: { type: Date,   default: Date.now },
    payer:  { type: PersonSchema, required: true },
    note:   { type: String, default: "" }
}, { _id: false });

const DebtSchema = new mongoose.Schema({
    kind: {
        type: String,
        enum: ["customer", "supplier"],
        default: "customer",
        index: true
    },
    saleId:        { type: mongoose.Schema.Types.ObjectId, ref: "Sale",     default: null },
    customerPhone: { type: String, default: null },
    supplierId:    { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null, index: true },
    totalDebt:     { type: Number, required: true, default: 0 },
    remainingDebt: { type: Number, required: true, default: 0 },
    note:          { type: String, default: "" },
    seller:        { type: PersonSchema, default: null },
    isClosed:      { type: Boolean, default: false },
    payments:      { type: [PaymentSchema], default: [] }
}, { timestamps: true });

// ✅ Compound indexes — qarz so'rovlar uchun tezlashtirish
DebtSchema.index({ isClosed: 1, kind: 1 });
DebtSchema.index({ isClosed: 1, createdAt: -1 });

const Debt = mongoose.model("Debt", DebtSchema);
module.exports = Debt;
