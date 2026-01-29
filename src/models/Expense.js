const { mongoose } = require("../db");

const ExpenseSchema = new mongoose.Schema(
    {
        spender: {
            tgId: { type: Number, required: true },
            tgName: { type: String, required: true }
        },
        title: { type: String, required: true },
        amount: { type: Number, required: true },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model("Expense", ExpenseSchema);
