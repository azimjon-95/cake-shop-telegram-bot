// src/services/saleGuard.js

const QTY_WORDS = [
    "ta", "dona", "kg", "gram", "litr", "x"
];

const MONEY_WORDS = [
    "ming", "million", "so'm", "som", "so‘m"
];

const SALE_WORDS = [
    "berdi", "oldi", "qarz", "tel", "telefon"
];

const NUMBER_WORDS = [
    "bir", "bitta", "ikki", "uch", "to‘rt", "tort", "besh",
    "olti", "yetti", "sakkiz", "to‘qqiz", "toqqiz", "o‘n", "on",
    "yigirma", "o'ttiz", "ottiz", "qirq", "ellik", "oltmish",
    "yetmish", "sakson", "to'qson", "toqson", "yuz"
];

function normalizeText(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function countMatches(text, arr) {
    return arr.reduce((acc, word) => {
        return acc + (text.includes(word) ? 1 : 0);
    }, 0);
}

function isLikelySaleText(rawText) {
    const text = normalizeText(rawText);
    if (!text) return false;

    const hasDigit = /\d/.test(text);
    const qtyHits = countMatches(text, QTY_WORDS);
    const moneyHits = countMatches(text, MONEY_WORDS);
    const saleHits = countMatches(text, SALE_WORDS);
    const numberWordHits = countMatches(text, NUMBER_WORDS);

    // juda qisqa va mazmunsiz bo‘lsa
    if (text.length < 4) return false;

    // kuchli signal
    if (hasDigit && (qtyHits > 0 || moneyHits > 0 || saleHits > 0)) return true;

    // digit yo‘q bo‘lsa ham gapirilgan raqam bo‘lishi mumkin
    if (numberWordHits >= 2 && (qtyHits > 0 || moneyHits > 0 || saleHits > 0)) return true;

    // kamida raqam + 1 ta mahsulotga o‘xshash matn
    if (hasDigit && text.split(" ").length >= 2) return true;

    return false;
}

function saleWarningText() {
    return [
        "⚠️ Faqat sotuv matnini kiriting.",
        "Iltimos, bu bo‘limga faqat mahsulot, soni va narxini yuboring.",
        "",
        "Misol:",
        "Napoleon 2ta 140000, Pepsi 1ta 17000",
        "",
        "💡 Limitni tejash uchun boshqa gaplarni bu yerga yozmang."
    ].join("\n");
}

module.exports = {
    isLikelySaleText,
    saleWarningText
};