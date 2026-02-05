const { formatMoney } = require("../utils/money");
const { escapeHtml } = require("./text");

/**
 * Cartni chiroyli textga aylantiradi
 * cart = [{ product, qty }]
 */
function formatCart(cart) {
    if (!cart || !cart.length) {
        return "🧺 Savat bo‘sh.";
    }

    let total = 0;

    const lines = cart.map((item, i) => {
        const p = item.product;
        const sum = p.salePrice * item.qty;
        total += sum;

        return (
            `${i + 1}. 🍰 <b>${escapeHtml(p.name)}</b>\n` +
            `   💰 ${formatMoney(p.salePrice)} × ${item.qty} = <b>${formatMoney(sum)}</b>`
        );
    });

    return (
        `🧺 <b>Savat</b>\n\n` +
        lines.join("\n\n") +
        `\n\n——————————\n` +
        `💵 <b>Jami:</b> ${formatMoney(total)} so‘m`
    );
}

module.exports = { formatCart };
