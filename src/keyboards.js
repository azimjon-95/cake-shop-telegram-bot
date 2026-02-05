// src/keyboards.js 
const { UZ_MONTHS } = require("./utils/months");
const CATEGORY_LIST = [
    "Tortlar",
    "Sovuq ichimliklar",
    "Perojniylar",
    "Choy/Kofe",
    "Fast Food",
    "Aksessuarlar",
];
function monthKeyboard(year) {
    // 12 oy inline button (3 tadan qator)
    const rows = [];
    for (let i = 0; i < 12; i += 3) {
        rows.push([
            { text: UZ_MONTHS[i], callback_data: `rep_month:${year}:${i}` },
            { text: UZ_MONTHS[i + 1], callback_data: `rep_month:${year}:${i + 1}` },
            { text: UZ_MONTHS[i + 2], callback_data: `rep_month:${year}:${i + 2}` }
        ]);
    }
    return { inline_keyboard: rows };
}
function mainMenuKeyboard() {
    return {
        keyboard: [
            [{ text: "🧁 Sotish" }, { text: "💸 Chiqim" }],
            // [{ text: "🧁 Sotish" }, { text: "Mahsulotlar" }, { text: "💸 Chiqim" }],
            [{ text: "📌 Qarzlar" }, { text: "🔒 Kasani yopish" }],
            [{ text: "📆 Oylik hisobot" }, { text: "ℹ️ Yordam" }],
            // [{ text: "🧁 Katalog" }]
        ],
        resize_keyboard: true
    };
}


function catalogKeyboard() {
    return {
        keyboard: [
            [{ text: "➕ Mahsulot qo‘shish" }, { text: "📦 Mahsulotlar" }],
            [{ text: "📂 Kategoriya bo‘yicha" }],
            [{ text: "⬅️ Menyu" }]
        ],
        resize_keyboard: true
    };
}



function startKeyboard() {
    return {
        reply_markup: {
            keyboard: [["▶️ Start"]],
            resize_keyboard: true
        }
    };
}
function categoryKeyboard() {
    return {
        inline_keyboard: CATEGORY_LIST.map(c => ([
            { text: c, callback_data: `cat:${c}` }
        ]))
    };
}

function productsKeyboard(products) {
    console.log(products);

    return {
        inline_keyboard: products.map(p => ([
            {
                text: `${p.name} — ${p.salePrice.toLocaleString("uz-UZ")} so‘m`,
                callback_data: `add:${p._id}`
            }
        ]))
    };
}

function productAddKeyboard(productId) {
    return {
        inline_keyboard: [
            [{ text: "➕ Savatga qo‘shish", callback_data: `add:${productId}` }]
        ]
    };
}


function backKeyboard() {
    return {
        reply_markup: {
            keyboard: [["⬅️ Orqaga"]],
            resize_keyboard: true
        }
    };
}

module.exports = {
    categoryKeyboard,
    productAddKeyboard,
    productsKeyboard, mainMenuKeyboard, startKeyboard, backKeyboard, monthKeyboard, catalogKeyboard
};
