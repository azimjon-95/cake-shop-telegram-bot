// src/models/Customer.js
const { mongoose } = require("../db");

const CustomerSchema = new mongoose.Schema({
    tgId:      { type: Number, unique: true, index: true },
    tgName:    { type: String, default: "" },
    points:    { type: Number, default: 0 },
    refCount:  { type: Number, default: 0 },
    refPoints: { type: Number, default: 0 },
    updatedAt: { type: Date,   default: Date.now },
}, { versionKey: false });

// ✅ Cashback reminder query uchun index
CustomerSchema.index({ points: 1, updatedAt: 1 });

const Customer = mongoose.model("Customer", CustomerSchema);
module.exports = Customer;
