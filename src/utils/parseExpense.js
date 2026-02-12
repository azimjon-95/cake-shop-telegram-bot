// src/utils/parseExpense.js
const { findAllNumbers } = require("./money");

function parseQty(text) {
    const s = String(text || "").toLowerCase();
    const m = s.match(/\b(\d+)\s*(ta|dona|x)\b/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    return 1;
}

function cleanTitle(text) {
    let s = String(text || "");
    // qty olib tashlanadi
    s = s.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");
    // raqamlar olib tashlanadi
    s = s.replace(/[\d\s.,]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s || "Chiqim";
}

function parseExpenseMessage(input) {
    let raw = String(input || "").trim();
    if (!raw) return null;

    const qty = parseQty(raw);

    // qty ni olib tashlab pul qidiramiz
    const withoutQty = raw.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");

    const nums = findAllNumbers(withoutQty)
        .filter(n => n >= 1000 && n < 100000000);

    if (nums.length === 0) return null;

    // odatda oxirgi raqam — narx
    const price = nums[nums.length - 1];

    const amount = qty * price;
    const title = cleanTitle(raw);

    return { title, amount };
}

module.exports = { parseExpenseMessage };