// src/keyboards.js 
const { UZ_MONTHS } = require("./utils/months");

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
            [{ text: "📌 Qarzlar" }, { text: "🔒 Kasani yopish" }],
            [{ text: "📆 Oylik hisobot" }, { text: "ℹ️ Yordam" }]
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

function backKeyboard() {
    return {
        reply_markup: {
            keyboard: [["⬅️ Orqaga"]],
            resize_keyboard: true
        }
    };
}

module.exports = { mainMenuKeyboard, startKeyboard, backKeyboard, monthKeyboard };
