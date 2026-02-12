const { UZ_MONTHS } = require("./utils/months");
const { EXPENSE_CATEGORIES } = require("./utils/expenseCategories");
const Supplier = require("./models/Supplier");
const { formatMoney } = require("./utils/money");
const { escapeHtml } = require("./logic/ui");

function monthKeyboard(year) {
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
            [{ text: "📌 Qarzlar" }, { text: "🔒 Kasani yopish" }],
            [{ text: "📆 Oylik hisobot" }, { text: "ℹ️ Yordam" }],
            [{ text: "📦 Kirim (Taminot)" }]
        ],
        resize_keyboard: true
    };
}

function startKeyboard() {
    return { reply_markup: { keyboard: [["▶️ Start"]], resize_keyboard: true } };
}

function backKeyboard() {
    return { reply_markup: { keyboard: [["⬅️ Orqaga"]], resize_keyboard: true } };
}

// ✅ Kirim kirish oynasi: 2 ta btn
function purchaseEntryKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "➕ Yangi firma qo‘shish", callback_data: "pur_menu_add_supplier" }],
            [{ text: "📦 Maxsulot keldi", callback_data: "pur_menu_products" }],
            [{ text: "❌ Bekor qilish", callback_data: "pur_cancel" }]
        ]
    };
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
    rows.push([{ text: "⬅️ Orqaga", callback_data: "exp_cancel" }]);
    return { inline_keyboard: rows };
}

// ✅ Supplier list (Maxsulot keldi uchun) - name + phone + desc qisqa
async function supplierListKeyboard({
    onlyWithDebt = false,
    backCb = "exp_cancel",
    selectCbPrefix = "sup_select",
    onlySuppliers = false
} = {}) {
    const q = {};
    if (onlySuppliers) q.name = { $ne: "📦 Kirim (Taminot)" };

    if (onlyWithDebt) q.debt = { $gt: 0 }; // ✅ endi debt Supplier’da

    const suppliers = await Supplier.find(q).sort({ name: 1 });

    if (suppliers.length === 0) {
        return {
            inline_keyboard: [
                [{ text: "✅ Qarzdor firma yo‘q", callback_data: "noop" }],
                [{ text: "⬅️ Orqaga", callback_data: backCb }]
            ]
        };
    }

    const rows = suppliers.map(s => {
        let t = `🎂 ${s.name}`;
        t += ` — 💳 ${formatMoney(s.debt || 0)} so'm`;

        return [{
            text: escapeHtml(t).slice(0, 64), // telegram limitdan oshmasin
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

    // ✅ All / Clear
    rows.push([
        { text: `✅ All`, callback_data: `rep_f_all:${year}:${monthIndex}` },
        { text: `🧹 Clear`, callback_data: `rep_f_none:${year}:${monthIndex}` }
    ]);

    // categories (2 tadan)
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

    // refresh
    rows.push([{ text: "🔄 Yangilash", callback_data: `rep_refresh:${year}:${monthIndex}` }]);

    return { inline_keyboard: rows };
}

module.exports = {
    monthKeyboard,
    mainMenuKeyboard,
    startKeyboard,
    backKeyboard,
    expenseCategoryKeyboard,
    supplierListKeyboard,
    purchaseEntryKeyboard,
    reportFiltersKeyboard
};