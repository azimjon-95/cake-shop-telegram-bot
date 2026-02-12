// src/models/Sale.js
const { mongoose } = require("../db");

const SaleItemSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        qty: { type: Number, required: true, default: 1 },
        price: { type: Number, required: true }, // bir dona narx
        paid: { type: Number, default: null } // agar bor bo‘lsa
    },
    { _id: false }
);

const SaleSchema = new mongoose.Schema(
    {
        orderNo: { type: String, index: true }, // ✅ qo‘shildi
        seller: {
            tgId: { type: Number, required: true },
            tgName: { type: String, required: true }
        },
        phone: { type: String, default: null },
        items: { type: [SaleItemSchema], required: true },
        total: { type: Number, required: true }, // qty*price yig‘indi
        paidTotal: { type: Number, required: true }, // real tushgan pul (qarz bo‘lsa kamroq)
        debtTotal: { type: Number, required: true }, // total - paidTotal
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model("Sale", SaleSchema);