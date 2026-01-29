const { formatMoney } = require("./money");
const { formatDT } = require("./time");

function saleNotifyText({ sellerName, itemsText, paidTotal, debtTotal, phone }) {
    const debtLine = debtTotal > 0 ? `\n📌 <b>Qarz:</b> ${formatMoney(debtTotal)} so'm` : "";
    const phoneLine = phone ? `\n📞 <b>Tel:</b> ${phone}` : "";
    return (
        `✅ <b>SOTUV</b>\n\n` +
        `👤 <b>Sotuvchi:</b> ${sellerName}\n` +
        `🧾 <b>Items:</b> ${itemsText}\n` +
        `💰 <b>Tushgan:</b> ${formatMoney(paidTotal)} so'm` +
        debtLine +
        phoneLine +
        `\n🕒 ${formatDT(new Date())}`
    );
}

function toNumber(v) {
    if (typeof v === "number") return v;
    return parseInt(String(v || "").replace(/[^\d]/g, ""), 10) || 0;
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function debtPayNotifyText({ payerName, note, phone, paid, remaining }) {
    // ✅ numberga aylantiramiz
    const paidNum = toNumber(paid);
    const remainingNum = toNumber(remaining);

    const phoneText = phone
        ? `\n📞 Tel: <a href="tel:+998${phone}">+998${phone}</a>`
        : "";

    return (
        `✅ <b>QARZ TO'LANDI</b>\n\n` +

        `🧾 Qarz: <b>${escapeHtml(note)}</b>` +
        phoneText + "\n" +
        `💰 To'landi: <b>${formatMoney(paidNum)}</b> so'm\n` +
        `📌 Qolgan: <b>${formatMoney(remainingNum)}</b> so'm`
    );
}

function expenseNotifyText({ spenderName, title, amount }) {
    return (
        `❌ <b>CHIQIM</b>\n\n` +
        `👤 <b>Kim:</b> ${spenderName}\n` +
        `🧾 <b>Nima:</b> ${title}\n` +
        `💸 <b>Summa:</b> -${formatMoney(amount)} so'm\n` +
        `🕒 ${formatDT(new Date())}`
    );
}

function closeNotifyText({ saleSum, expenseSum, debtSum, balance, from, to }) {
    return (
        `🔒 <b>KASA YOPILDI</b>\n\n` +
        `🗓 <b>Oraliq:</b> ${formatDT(from)} → ${formatDT(to)}\n` +
        `✅ <b>Sotuv (tushgan):</b> ${formatMoney(saleSum)} so'm\n` +
        `❌ <b>Chiqim:</b> ${formatMoney(expenseSum)} so'm\n` +
        `📌 <b>Qarzlar (qolgan):</b> ${formatMoney(debtSum)} so'm\n` +
        `🏦 <b>Balans:</b> ${formatMoney(balance)} so'm`
    );
}

module.exports = { debtPayNotifyText, saleNotifyText, expenseNotifyText, closeNotifyText };
