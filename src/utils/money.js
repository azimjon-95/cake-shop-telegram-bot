// src/utils/money.js

function toIntMoney(raw) {
    // "140 000" / "140000" / "140,000" / "140.000" -> 140000
    const s = String(raw || "")
        .replace(/[^\d]/g, "")
        .trim();
    if (!s) return 0;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString("uz-UZ");
}

/**
 * ✅ MUHIM FIX
 * - "140000 100000"  -> [140000, 100000]
 * - "140 000"        -> [140000]
 * - "100,000"        -> [100000]
 * - "100.000"        -> [100000]
 */
function findAllNumbers(str) {
    const s = String(str || "");

    const matches = s.match(/\d{1,3}(?:[.,\s]\d{3})+|\d+/g);
    if (!matches) return [];

    return matches
        .map(toIntMoney)
        .filter((x) => x > 0);
}

// ❌ endi findPhone kerak emas (telefon faqat "tel" bilan olinadi)
module.exports = {
    toIntMoney,
    formatMoney,
    findAllNumbers
};
