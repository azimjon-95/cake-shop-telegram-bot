// src/keyboards.js
const { UZ_MONTHS } = require("./utils/months");
const { EXPENSE_CATEGORIES } = require("./utils/expenseCategories");
const Supplier = require("./models/Supplier");
const { SALE_TEMPLATE_ITEMS } = require("./logic/saleDraft");
const { formatMoney } = require("./utils/money");
const { escapeHtml } = require("./logic/ui");

function monthKeyboard(year) {
    const rows = [];
    for (let i = 0; i < 12; i += 3) {
        rows.push([
            { text: UZ_MONTHS[i],     callback_data: `rep_month:${year}:${i}` },
            { text: UZ_MONTHS[i + 1], callback_data: `rep_month:${year}:${i + 1}` },
            { text: UZ_MONTHS[i + 2], callback_data: `rep_month:${year}:${i + 2}` }
        ]);
    }
    return { inline_keyboard: rows };
}

function mainMenuKeyboard(waUrl) {
    const keyboard = [
        [{ text: "🧁 Sotish" }, { text: "💸 Chiqim" }],
        [{ text: "📌 Qarzlar" }, { text: "🔒 Kasani yopish" }],
        [{ text: "📦 Kirim (Taminot)" }, { text: "📆 Oylik hisobot" }],
        [{ text: "🎁 Kashback orqali xarid" }, { text: "📋 Menyu" }],
    ];
    return { keyboard, resize_keyboard: true };
}

// Inline webapp tugmalar (🌐 WebApp + 📵 Offline)
function webAppButtons(waUrl) {
    if (!waUrl) return null;
    return {
        inline_keyboard: [[
            {
                text: "🌐 Dashboard",
                web_app: { url: waUrl }
            },
            {
                text: "📵 Offline rejim",
                web_app: { url: `${waUrl}?offline=1` }
            }
        ]]
    };
}

function startKeyboard() {
    return { reply_markup: { keyboard: [["▶️ Start"]], resize_keyboard: true } };
}

function backKeyboard() {
    return { reply_markup: { keyboard: [["⬅️ Orqaga"]], resize_keyboard: true } };
}

function purchaseEntryKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "➕ Yangi firma qo'shish", callback_data: "pur_menu_add_supplier" }],
            [{ text: "📦 Maxsulot keldi",       callback_data: "pur_menu_products" }],
            [{ text: "❌ Bekor qilish",          callback_data: "pur_cancel" }]
        ]
    };
}

function menuKeyboard(isAdmin = false) {
    const rows = [
        [{ text: "👥 Foydalanuvchilar" }, { text: "ℹ️ Yordam" }],
        [{ text: "💸 Chiqimlar hisobot" }],
    ];
    if (isAdmin) {
        rows.push([{ text: "💰 Balansni tahrirlash" }, { text: "📤 Backup yuborish" }]);
        rows.push([{ text: "📌 Pin xabar yuborish" }]);
    }
    rows.push([{ text: "⬅️ Orqaga" }]);
    return { keyboard: rows, resize_keyboard: true };
}

function expenseCategoryKeyboard() {
    const rows = [];
    for (let i = 0; i < EXPENSE_CATEGORIES.length; i += 2) {
        const a = EXPENSE_CATEGORIES[i];
        const b = EXPENSE_CATEGORIES[i + 1];
        const row = [{ text: a.text, callback_data: `exp_cat:${a.key}` }];
        if (b) row.push({ text: b.text, callback_data: `exp_cat:${b.key}` });
        rows.push(row);
    }
    rows.push([{ text: "⬅️ Bekor qilish", callback_data: "exp_cancel" }]);
    return { inline_keyboard: rows };
}

async function supplierListKeyboard({
    onlyWithDebt = false,
    backCb = "exp_cancel",
    selectCbPrefix = "sup_select",
    onlySuppliers = false
} = {}) {
    const q = {};
    if (onlySuppliers) q.name = { $ne: "📦 Kirim (Taminot)" };
    if (onlyWithDebt) q.debt = { $gt: 0 };

    const suppliers = await Supplier.find(q).sort({ name: 1 });

    if (suppliers.length === 0) {
        return {
            inline_keyboard: [
                [{ text: "✅ Qarzdor firma yo'q", callback_data: "noop" }],
                [{ text: "⬅️ Orqaga", callback_data: backCb }]
            ]
        };
    }

    const rows = suppliers.map(s => {
        let t = `🎂 ${s.name} — 💳 ${formatMoney(s.debt || 0)} so'm`;
        return [{
            text: escapeHtml(t).slice(0, 64),
            callback_data: `${selectCbPrefix}:${s._id}`
        }];
    });

    rows.push([{ text: "⬅️ Orqaga", callback_data: backCb }]);
    return { inline_keyboard: rows };
}

function reportFiltersKeyboard({ year, monthIndex, selectedKeys = [] }) {
    const allKeys = EXPENSE_CATEGORIES.map(x => x.key);
    const selected = new Set(selectedKeys.length ? selectedKeys : allKeys);

    const rows = [];
    rows.push([
        { text: "✅ All",   callback_data: `rep_f_all:${year}:${monthIndex}` },
        { text: "🧹 Clear", callback_data: `rep_f_none:${year}:${monthIndex}` }
    ]);

    for (let i = 0; i < EXPENSE_CATEGORIES.length; i += 2) {
        const a = EXPENSE_CATEGORIES[i];
        const b = EXPENSE_CATEGORIES[i + 1];
        const aMark = selected.has(a.key) ? "✅" : "☑️";
        const row = [{ text: `${aMark} ${a.text}`, callback_data: `rep_f:${year}:${monthIndex}:${a.key}` }];
        if (b) {
            const bMark = selected.has(b.key) ? "✅" : "☑️";
            row.push({ text: `${bMark} ${b.text}`, callback_data: `rep_f:${year}:${monthIndex}:${b.key}` });
        }
        rows.push(row);
    }
    rows.push([{ text: "🔄 Yangilash", callback_data: `rep_refresh:${year}:${monthIndex}` }]);
    return { inline_keyboard: rows };
}

function saleInputModeKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "🧩 Nomlardan tanlash", callback_data: "sale_tpl_open" }]
        ]
    };
}

function saleTemplatesKeyboard(category = "tortlar") {
    const currentItems = SALE_TEMPLATE_ITEMS[category] || SALE_TEMPLATE_ITEMS.tortlar;

    const categoryRow = [
        { text: category === "tortlar"    ? "✅ 🎂 Tortlar"       : "🎂 Tortlar",       callback_data: "sale_tpl_cat:tortlar" },
        { text: category === "perojniylar"? "✅ 🧁 Perojniylar"   : "🧁 Perojniylar",   callback_data: "sale_tpl_cat:perojniylar" },
        { text: category === "ichimliklar"? "✅ 🥤 Ichimliklar"   : "🥤 Ichimliklar",   callback_data: "sale_tpl_cat:ichimliklar" },
        { text: category === "aks"        ? "✅ 📦 Aksessuarlar"  : "📦 Aksessuarlar",  callback_data: "sale_tpl_cat:aks" },
    ];

    const itemRows = [];
    for (let i = 0; i < currentItems.length; i += 2) {
        const row = currentItems.slice(i, i + 2).map(item => ({
            text: item.name,
            callback_data: `sale_tpl_add:${item.name}`,
        }));
        itemRows.push(row);
    }

    return {
        inline_keyboard: [
            categoryRow,
            ...itemRows,
            [
                { text: "⬅️ Ortga",  callback_data: "sale_tpl_cancel" },
                { text: "🧹 Tozalash", callback_data: "sale_tpl_clear" },
            ],
        ],
    };
}

// ✅ Foydalanuvchi qo'shish — Contact Share tugmasi bilan
function addWorkerKeyboard() {
    return {
        keyboard: [
            // request_contact: true => Telegram "Kontaktni ulash" dialog oynasini chiqaradi
            [{ text: "📱 Kontakt ulashing", request_contact: true }],
            [{ text: "⬅️ Orqaga" }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false  // bir marta bosib keyin yo'qolmasin
    };
}

function usersKeyboard() {
    return {
        keyboard: [
            [{ text: "➕ Foydalanuvchi qo'shish" }],
            [{ text: "📋 Foydalanuvchilar ro'yxati" }],
            [{ text: "⬅️ Orqaga" }],
        ],
        resize_keyboard: true,
    };
}

function expenseReportCategoryKeyboard() {
    return {
        keyboard: [
            [{ text: "🧾 Proche rasxodlar" }, { text: "🏠 Arenda" }],
            [{ text: "⚡ Elektr energiya" },  { text: "🏷 Firma (Taminotga)" }],
            [{ text: "💰 Kapilka" },          { text: "👷 Ishchiga" }],
            [{ text: "🍽 Abetga" },           { text: "🚕 Taksiga" }],
            [{ text: "🛠 Ustaga" },           { text: "🏦 Bank / Soliq to'lovlari" }],
            [{ text: "📊 Hammasi" }],
            [{ text: "⬅️ Orqaga" }]
        ],
        resize_keyboard: true
    };
}

module.exports = {
    webAppButtons,
    expenseReportCategoryKeyboard,
    monthKeyboard,
    mainMenuKeyboard,
    startKeyboard,
    backKeyboard,
    expenseCategoryKeyboard,
    supplierListKeyboard,
    purchaseEntryKeyboard,
    reportFiltersKeyboard,
    saleInputModeKeyboard,
    saleTemplatesKeyboard,
    menuKeyboard,
    usersKeyboard,
    addWorkerKeyboard,
};
