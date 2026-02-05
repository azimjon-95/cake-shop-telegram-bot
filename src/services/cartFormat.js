// src/services/cartFormat.js
const { escapeHtml } = require("../helpers/text");

function formatMoney(n) {
    return Number(n || 0).toLocaleString("uz-UZ");
}

function formatCart(items, totals) {
    if (!items.length) return "🧺 <b>Savat bo‘sh</b>";

    let t = `🧺 <b>Savat</b>\n\n`;
    items.forEach((it, i) => {
        const price = Number(it.soldPrice ?? it.product?.salePrice ?? 0);
        t += `${i + 1}. 🍰 <b>${escapeHtml(it.product.name)}</b>\n`;
        t += `   💰 ${formatMoney(price)} × ${it.qty} = <b>${formatMoney(price * it.qty)}</b>\n\n`;
    });

    t += `——————————\n`;
    t += `💵 <b>Jami:</b> ${formatMoney(totals.subtotalSold)} so‘m\n`;
    if (totals.discount > 0) {
        t += `🏷 <b>Chegirma:</b> ${formatMoney(totals.discount)} so‘m\n`;
    }
    t += `\n✍️ Narxni o‘zgartirish: chatga <b>yangi narx</b> yozing (masalan: 45000)`;
    return t;
}

module.exports = { formatCart };
