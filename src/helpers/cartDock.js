// src/helpers/cartDock.js

async function upsertCartMessage(bot, redis, chatId, text, reply_markup) {
  const key = `cart_msg:${String(chatId)}`;
  const saved = await redis.get(key);

  // agar bor bo'lsa edit qilamiz
  if (saved) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: Number(saved),
        parse_mode: "HTML",
        reply_markup,
      });
      return Number(saved);
    } catch {
      // edit bo'lmasa yangidan yuboramiz
    }
  }

  const sent = await bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    reply_markup,
  });

  await redis.set(key, String(sent.message_id), "EX", 86400);
  return sent.message_id;
}

async function tryPinCart(bot, chatId, messageId) {
  try {
    // old pinni olib tashlaymiz (shunda "Удалённое сообщение" chiqishi kamayadi)
    try { await bot.unpinChatMessage(chatId); } catch { }

    await bot.pinChatMessage(chatId, messageId, { disable_notification: true });
  } catch {
    // ruxsat bo'lmasa jim
  }
}

module.exports = { upsertCartMessage, tryPinCart };
