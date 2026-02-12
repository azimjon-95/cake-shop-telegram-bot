// Xaridlar modeli
const mongoose = require("mongoose");

const PersonSchema = new mongoose.Schema({
    tgId: { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const PurchaseSchema = new mongoose.Schema({
    orderNo: { type: String, required: true },

    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },

    // faqat jami pul (kirim)
    totalCost: { type: Number, required: true },

    description: { type: String, default: "" },

    createdBy: { type: PersonSchema, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Purchase", PurchaseSchema);
