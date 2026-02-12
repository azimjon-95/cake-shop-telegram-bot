// src/logic/ui.js
const dayjs = require("dayjs");
const { formatMoney } = require("../utils/money");

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function getUserName(msg) {
    const u = msg.from || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    return name || u.username || String(u.id);
}

function itemsToText(items) {
    return items.map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`).join(", ");
}

function deleteSaleKeyboard(saleId) {
    return { reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish (Sotuv)", callback_data: `del_sale:${saleId}` }]] } };
}
function deleteExpenseKeyboard(expenseId) {
    return { reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish (Chiqim)", callback_data: `del_exp:${expenseId}` }]] } };
}

function debtPayButton(debtId) {
    return { reply_markup: { inline_keyboard: [[{ text: "💳 To'lash", callback_data: `pay:${debtId}` }]] } };
}
function payAmountKeyboard(debtId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "To'liq to'lash", callback_data: `payfull:${debtId}` }],
                [{ text: "Qisman to'lash", callback_data: `paypart:${debtId}` }]
            ]
        }
    };
}

function formatDebtCard(d) {
    const when = dayjs(d.createdAt).format("DD-MMM HH:mm");

    let phoneLine = "";
    if (d.customerPhone) {
        let p = String(d.customerPhone).replace(/[^\d]/g, "");
        if (p.length === 9) p = "998" + p;
        phoneLine = `📞 <b>Tel:</b> <a href="tel:+${p}">+${p}</a>\n`;
    }

    const note = d.note ? escapeHtml(d.note) : "-";

    return (
        `📌 <b>Qarz</b>\n` +
        `🕒 <b>Qachon:</b> ${when}\n` +
        phoneLine +
        `🧾 <b>Izoh:</b> ${note}\n` +
        `💰 <b>Qolgan:</b> ${formatMoney(d.remainingDebt)} so'm`
    );
}

module.exports = {
    escapeHtml,
    getUserName,
    itemsToText,
    deleteSaleKeyboard,
    deleteExpenseKeyboard,
    debtPayButton,
    payAmountKeyboard,
    formatDebtCard
};
