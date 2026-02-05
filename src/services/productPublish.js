// src/services/productPublish.js
const { formatMoney } = require("../utils/money");

async function publishProductToChannel(bot, channelId, product) {
    console.log("CHANNEL_ID yo‘q (kanal id kerak)", channelId);

    if (!channelId) throw new Error("CHANNEL_ID yo‘q (kanal id kerak)");

    const caption =
        `🍰 <b>${escapeHtml(product.name)}</b>\n\n` +
        (product.oldPrice ? `🏷 <b>Eski:</b> ${formatMoney(product.oldPrice)} so'm\n` : "") +
        (product.desc ? `📝 ${escapeHtml(product.desc)}\n` : "")

    // Rasm bo‘lsa — rasm bilan post
    if (product.photo?.tgFileId) {
        return bot.sendPhoto(channelId, product.photo.tgFileId, {
            caption,
            parse_mode: "HTML",
        });
    }

    // Rasm bo‘lmasa — oddiy xabar
    return bot.sendMessage(channelId, caption, {
        parse_mode: "HTML",
    });
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

module.exports = { publishProductToChannel };
