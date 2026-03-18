// src/utils/money.js
function normalizeMoneyText(raw = "") {
    return String(raw)
        .toLowerCase()
        .replace(/so['’`]?m/gi, "")
        .replace(/sum/gi, "")
        .replace(/\bk\b/gi, " ming")
        .replace(/(\d)\s*k\b/gi, "$1 ming")
        .replace(/(\d)k\b/gi, "$1 ming")
        .replace(/\s+/g, " ")
        .trim();
}
function toIntMoney(raw) {
    let s = normalizeMoneyText(raw);

    if (!s) return 0;

    // 120ming / 120min / 120 ming / 120 mingdan
    const thousandMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*(ming|min|minga|mingdan)$/i);
    if (thousandMatch) {
        const n = Number(String(thousandMatch[1]).replace(",", "."));
        return Math.round(n * 1000);
    }

    // Faqat son bo‘lsa
    if (/^\d+$/.test(s)) {
        const n = Number(s);

        // 1..999 => ming deb qabul qilamiz
        if (n >= 1 && n <= 999) return n * 1000;

        // 1000+ => o‘zicha qoladi
        return n;
    }

    // 120 ming so‘m, 15 min, 12 mingdan kabi ichida bo‘lsa
    s = s.replace(/(\d+(?:[.,]\d+)?)\s*(ming|min|minga|mingdan)/gi, (_, num) => {
        return String(Math.round(Number(String(num).replace(",", ".")) * 1000));
    });

    // Oxirgi raqamni olamiz
    const nums = s.match(/\d+/g);
    if (!nums || !nums.length) return 0;

    const n = Number(nums[nums.length - 1]);

    if (n >= 1 && n <= 999) return n * 1000;
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
