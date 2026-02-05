// src/utils/parseProductLine.js
function parseProductLine(text) {
    const raw = String(text || "").trim();
    const parts = raw.split("|").map((x) => x.trim()).filter(Boolean);

    // Kamida: 6 ta bo‘lishi kerak
    if (parts.length < 6) return null;

    const [code, name, category, salePrice, costPrice, qty, ...descParts] = parts;

    const toNum = (v) => {
        const n = Number(String(v || "").replace(/[^\d.-]/g, ""));
        return Number.isFinite(n) ? n : 0;
    };

    return {
        code: String(code || "").trim().toUpperCase(),
        name: String(name || "").trim(),
        category: String(category || "").trim().toLowerCase(),
        salePrice: Math.max(0, toNum(salePrice)),
        costPrice: Math.max(0, toNum(costPrice)),
        qty: Math.max(0, Math.trunc(toNum(qty))),
        desc: descParts.join(" | ").trim(), // ixtiyoriy
    };
}

module.exports = { parseProductLine };
