const { mongoose } = require("../db");

const SupplierSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: null },
    debt: { type: Number, default: 0 },
    description: { type: String, default: "" }, // nima mahsulot keltiradi
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model("Supplier", SupplierSchema);
