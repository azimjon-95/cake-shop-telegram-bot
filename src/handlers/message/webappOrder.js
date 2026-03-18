const { GROUP_CHAT_ID } = require("../../config");
const { escHtml, normalizePhone } = require("./helpers");

async function handleWebAppOrder(bot, msg) {
    const wad = msg?.web_app_data?.data;
    if (!wad) return false;

    let data;
    try {
        data = JSON.parse(wad);
    } catch (e) {
        await bot.sendMessage(msg.chat.id, "❌ WebApp data xato (JSON parse bo‘lmadi).");
        return true;
    }

    const user = msg.from || {};
    const fromName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
    const username = user.username ? `@${user.username}` : "—";

    const cake = escHtml(data.cake || "—");
    const price = escHtml(data.price || "—");
    const clientName = escHtml(data.name || "—");
    const phone = escHtml(normalizePhone(data.phone) || "—");

    const text =
        `🧁 <b>Yangi zakaz!</b>\n\n` +
        `🍰 <b>Tort:</b> ${cake}\n` +
        `💵 <b>Narx:</b> ${price}\n` +
        `👤 <b>Mijoz:</b> ${clientName}\n` +
        `📞 <b>Tel:</b> <code>${phone}</code>\n\n` +
        `🙋‍♂️ <b>Telegram:</b> ${escHtml(fromName)} (${escHtml(username)})\n` +
        `🆔 <b>TG ID:</b> <code>${user.id || "—"}</code>`;

    const target = GROUP_CHAT_ID || msg.chat.id;

    try {
        if (data.img) {
            await bot.sendPhoto(target, data.img, { caption: text, parse_mode: "HTML" });
        } else {
            await bot.sendMessage(target, text, { parse_mode: "HTML" });
        }
    } catch {
        await bot.sendMessage(target, text, { parse_mode: "HTML" });
    }

    await bot.sendMessage(msg.chat.id, "✅ Zakazingiz qabul qilindi! Tez orada aloqaga chiqamiz. 🙌");
    return true;
}

module.exports = { handleWebAppOrder };