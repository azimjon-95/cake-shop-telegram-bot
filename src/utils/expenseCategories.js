// src/utils/expenseCategories.js
// ✅ Barcha joylarda bir xil key ishlatilsin
const EXPENSE_CATEGORIES = [
    { key: "other",     text: "🧾 Proche rasxodlar" },
    { key: "rent",      text: "🏠 Arenda" },
    { key: "electric",  text: "⚡ Elektr energiya" },
    { key: "supplier",  text: "🏷 Firma (Taminotga)" },
    { key: "cashbox",   text: "💰 Kapilka" },
    { key: "worker",    text: "👷 Ishchiga" },
    { key: "lunch",     text: "🍽 Abetga" },
    { key: "taxi",      text: "🚕 Taksiga" },
    { key: "master",    text: "🛠 Ustaga" },
    { key: "bank_tax",  text: "🏦 Bank / Soliq to'lovlari" },
];

// Tez qidirish uchun map
const EXPENSE_CATEGORY_MAP = Object.fromEntries(
    EXPENSE_CATEGORIES.map(c => [c.key, c.text])
);

function getCategoryTitle(key) {
    if (key === "all") return "Hammasi";
    return EXPENSE_CATEGORY_MAP[key] || key || "Boshqa";
}

module.exports = { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_MAP, getCategoryTitle };
