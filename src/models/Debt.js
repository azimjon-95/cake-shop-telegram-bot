const { mongoose } = require("../db");

const DebtSchema = new mongoose.Schema(
    {
        saleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", required: true },
        customerPhone: { type: String, default: null },

        // qarz summasi:
        totalDebt: { type: Number, required: true },
        remainingDebt: { type: Number, required: true },

        // sotuvchi:
        seller: {
            tgId: { type: Number, required: true },
            tgName: { type: String, required: true }
        },

        // qisqa tavsif:
        note: { type: String, required: true },

        isClosed: { type: Boolean, default: false },

        payments: [
            {
                amount: { type: Number, required: true },
                paidBy: {
                    tgId: { type: Number, required: true },
                    tgName: { type: String, required: true }
                },
                createdAt: { type: Date, default: Date.now }
            }
        ],

        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model("Debt", DebtSchema);
