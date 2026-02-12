// src/services/supplierService.js
const Supplier = require("../models/Supplier");

function normName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
}

async function createOrGetSupplier({ name, phone = null, description = "" }) {
    const n = normName(name);
    if (!n) throw new Error("Firma nomi bo‘sh bo‘lmasin");

    let sup = await Supplier.findOne({ name: n });
    if (sup) return sup;

    sup = await Supplier.create({
        name: n,
        phone: phone ? String(phone).trim() : null,
        description: description ? String(description).trim() : ""
    });

    return sup;
}

async function listSuppliers({ q = "", limit = 30 } = {}) {
    const query = {};
    const s = String(q || "").trim();
    if (s) query.name = { $regex: s, $options: "i" };

    return Supplier.find(query).sort({ name: 1 }).limit(limit);
}

async function getSupplierById(id) {
    return Supplier.findById(id);
}

module.exports = { createOrGetSupplier, listSuppliers, getSupplierById };
