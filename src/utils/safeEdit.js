async function safeEdit(bot, q, { text, reply_markup, parse_mode = "HTML" }) {
    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;

    const hasPhoto = Array.isArray(q.message.photo) && q.message.photo.length > 0;

    try {
        // PHOTO bo'lsa caption edit qilamiz
        if (hasPhoto) {
            return await bot.editMessageCaption(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode,
                reply_markup,
            });
        }

        // Oddiy text xabar bo'lsa text edit qilamiz
        return await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode,
            reply_markup,
        });
    } catch (err) {
        const desc = err?.response?.body?.description || err?.message || "";

        // Ba'zan Telegram "message is not modified" ham error beradi - shuni jim o'tkazamiz
        if (desc.includes("message is not modified")) return;

        // Agar umuman edit qilib bo'lmasa (masalan, xabar boshqa tur), fallback: yangi xabar yuborib qo'yamiz
        if (desc.includes("there is no text in the message to edit")) {
            return bot.sendMessage(chatId, text, { parse_mode, reply_markup });
        }

        throw err;
    }
}

module.exports = { safeEdit };
