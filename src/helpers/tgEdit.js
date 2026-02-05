// src/helpers/tgEdit.js
async function editSmart(bot, q, { text, reply_markup, parse_mode = "HTML" }) {
    const chat_id = q.message.chat.id;
    const message_id = q.message.message_id;

    const hasMedia =
        (Array.isArray(q.message.photo) && q.message.photo.length > 0) ||
        q.message.video ||
        q.message.document ||
        q.message.animation;

    // Telegram bo'sh caption/text qabul qilmaydi
    const safeText = text && String(text).trim() ? text : "…";

    try {
        if (hasMedia) {
            return await bot.editMessageCaption(safeText, {
                chat_id,
                message_id,
                parse_mode,
                reply_markup,
            });
        }

        return await bot.editMessageText(safeText, {
            chat_id,
            message_id,
            parse_mode,
            reply_markup,
        });
    } catch (err) {
        const desc = err?.response?.body?.description || err?.message || "";

        // "message is not modified" — jim o'tkazamiz
        if (desc.includes("message is not modified")) return;

        // Agar edit bo'lmasa — fallback: yangi xabar
        if (desc.includes("there is no text in the message to edit")) {
            return bot.sendMessage(chat_id, safeText, {
                parse_mode,
                reply_markup,
            });
        }

        throw err;
    }
}

module.exports = { editSmart };
