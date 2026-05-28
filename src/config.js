// src/config.js
require("dotenv").config();

const allowedIds = (process.env.WEBAPP_ALLOWED_TG_IDS || "")
    .split(",")
    .map(x => Number(String(x).trim()))
    .filter(Boolean);


module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    MONGO_URI: process.env.MONGO_URI,
    REDIS_URL: process.env.REDIS_URL,
    BOT_PASSWORD: process.env.BOT_PASSWORD || "1234",
    GROUP_CHAT_ID: String(process.env.GROUP_CHAT_ID || ""),
    TZ: process.env.TZ || "Asia/Tashkent",
    AUTH_TTL_SECONDS: 60 * 60 * 24 * 2, // 2 kun
    WEBAPP_URL: process.env.WEBAPP_URL, // masalan: https://your-site.com
    PORT: process.env.PORT || 6060,

    // ---------- qo'shimcha konfiguratsiyalar ----------
    CUSTOMER_BOT_TOKEN: process.env.CUSTOMER_BOT_TOKEN,
    CUSTOMER_BOT_USERNAME: process.env.CUSTOMER_BOT_USERNAME, // masalan: totli_rewards_bot
    MIN_QR_PAID: Number(process.env.MIN_QR_PAID || 70000),
    GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || "",
    GROUP_ID: process.env.GROUP_ID || "",
    WEBAPP_ALLOWED_TG_IDS: allowedIds,
    // Admin — faqat shu tgId balansni tahrirlayoladi
    ADMIN_TG_ID: Number(process.env.ADMIN_TG_ID || 0),
    // Backup gruppa chat ID (BACKUP_CHAT_ID)
    BACKUP_CHAT_ID: process.env.BACKUP_CHAT_ID ? String(process.env.BACKUP_CHAT_ID) : null,
    // Statistika SMS yuboriladigan guruh (bo'sh bo'lsa GROUP_CHAT_ID ishlatiladi)
    // Tort pishiruvchi (Zubayda) Telegram ID — unga alohida kun rejasi yuboriladi
    BAKER_TG_ID: process.env.BAKER_TG_ID ? String(process.env.BAKER_TG_ID) : null,
    STATS_CHAT_ID: process.env.STATS_CHAT_ID ? String(process.env.STATS_CHAT_ID) : (process.env.GROUP_CHAT_ID ? String(process.env.GROUP_CHAT_ID) : null),
};