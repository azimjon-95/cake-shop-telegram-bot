// src/bot/helpers/balance.js
const Counter = require("../models/Counter");

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;
    const created = await Counter.create([{ key: "balance", value: 0 }], session ? { session } : undefined);
    return created[0];
}

async function addBalance(amount, session) {
    const bal = await ensureBalance(session);
    bal.value += amount;
    await bal.save({ session });
    return bal.value;
}

module.exports = { ensureBalance, addBalance };
