// src/utils/money.js

function toIntMoney(raw) {
    // "140 000" / "140000" / "140,000" / "140.000" -> 140000
    // "100min" / "100ming" / "100 ming" -> 100000
    const s0 = String(raw || "").trim().toLowerCase();
    if (!s0) return 0;

    // min/ming suffix bor-yo‘qligini tekshiramiz
    const hasThousandWord = /\b(min|ming)\b/.test(s0) || /(min|ming)$/.test(s0);

    // faqat raqamlarni ajratib olamiz
    const digits = s0.replace(/[^\d]/g, "");
    if (!digits) return 0;

    let n = parseInt(digits, 10);
    if (!Number.isFinite(n)) return 0;

    // ✅ 100min => 100 * 1000
    if (hasThousandWord) n = n * 1000;

    return n;
}

function formatMoney(n) {
    const v = Number(n || 0);
    return v.toLocaleString("uz-UZ");
}

function findAllNumbers(str) {
    // ✅ oddiy sonlar + "min/ming" bilan yozilganlarini ham topadi
    // misol: "Tort 100min", "Tort 100 ming", "100ming", "140 000"
    const s = String(str || "");

    const matches = s.match(
        /\d{1,3}(?:[.,\s]\d{3})+\s*(?:min|ming)?\b|\d+\s*(?:min|ming)\b|\d+/gi
    );

    if (!matches) return [];

    return matches
        .map(toIntMoney)
        .filter((x) => Number.isFinite(x) && x > 0);
}

module.exports = {
    toIntMoney,
    formatMoney,
    findAllNumbers
};
