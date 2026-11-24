// Expense model
const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    tgId: { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const ExpenseSchema = new mongoose.Schema({
    orderNo: { type: String, required: true },
    // Filial: yo'q/null bo'lsa — "sang" (eski ma'lumotlar)
    branchId: { type: String, default: "sang" },
    spender: { type: PersonSchema, required: true },

    // eski title/amount
    title: { type: String, required: true },
    amount: { type: Number, required: true },

    // NEW
    categoryKey: { type: String, default: "other" },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    description: { type: String, default: "" },
    // Idempotentlik kaliti (ovozli chiqim). Eski yozuvlarda yo'q
    idemKey: { type: String }
}, { timestamps: true });

// ✅ createdAt indeksi — dashboard aggregate va filter uchun
ExpenseSchema.index({ createdAt: 1 });
ExpenseSchema.index({ branchId: 1, createdAt: -1 });
ExpenseSchema.index({ idemKey: 1 }, { unique: true, partialFilterExpression: { idemKey: { $type: "string" } } });

module.exports = mongoose.model("Expense", ExpenseSchema);
