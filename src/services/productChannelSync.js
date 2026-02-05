const Product = require("../models/Product");

async function deleteChannelPostIfOutOfStock(bot, productId) {
    const p = await Product.findById(productId);
    if (!p) return;

    if (p.qty > 0) return; // hali bor

    const chatId = p.channelPost?.chatId;
    const messageId = p.channelPost?.messageId;

    if (!chatId || !messageId) return;

    try {
        await bot.deleteMessage(chatId, messageId);

        // ✅ o'chirgandan keyin post idni tozalab qo'yamiz
        p.channelPost = { chatId: null, messageId: null };
        await p.save();
    } catch (e) {
        // bot admin bo'lmasa yoki rights yetmasa shu yerga tushadi
        console.log("❌ deleteMessage error:", e?.response?.body || e?.message || e);
    }
}

module.exports = { deleteChannelPostIfOutOfStock };
