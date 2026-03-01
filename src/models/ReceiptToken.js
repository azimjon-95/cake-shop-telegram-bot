// src/models/ReceiptToken.js
const { mongoose } = require("../db");

const ReceiptTokenSchema = new mongoose.Schema({
    token: { type: String, unique: true, index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", required: true, index: true },
    orderNo: { type: String, index: true },

    minPaid: { type: Number, default: 70000 },

    saleTotal: { type: Number, default: 0 },
    salePaid: { type: Number, default: 0 },

    status: { type: String, enum: ["NEW", "REDEEMED"], default: "NEW", index: true },
    redeemedAt: { type: Date, default: null },
    redeemedByTgId: { type: Number, default: null, index: true },

    createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

module.exports = mongoose.model("ReceiptToken", ReceiptTokenSchema);
