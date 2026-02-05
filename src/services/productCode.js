// src/services/productCode.js
const Counter = require("../models/Counter");

async function nextProductCode(session) {
    const doc = await Counter.findOneAndUpdate(
        { key: "productCode" },
        { $inc: { value: 1 } },
        { new: true, upsert: true, session }
    );

    const n = Number(doc.value || 1);
    return "T" + String(n).padStart(4, "0"); // T0001
}

module.exports = { nextProductCode };
