const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    tgId: { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const ExpenseSchema = new mongoose.Schema({
    orderNo: { type: String, required: true },
    spender: { type: PersonSchema, required: true },

    // eski title/amount
    title: { type: String, required: true },
    amount: { type: Number, required: true },

    // NEW
    categoryKey: { type: String, default: "other" },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    description: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.model("Expense", ExpenseSchema);
