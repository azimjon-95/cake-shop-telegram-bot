// src/services/orderNo.js
const Counter = require("../models/Counter");

// umumiy sequence: 1,2,3,... format: 0001..9999, keyin 10000...
async function nextOrderNo(session) {
    const doc = await Counter.findOneAndUpdate(
        { key: "order_seq" },
        { $inc: { value: 1 } },
        { new: true, upsert: true, session: session || null }
    );

    const n = Number(doc.value || 0);
    const width = n <= 9999 ? 4 : 5;
    return String(n).padStart(width, "0");
}

module.exports = { nextOrderNo };
