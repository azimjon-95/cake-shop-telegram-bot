// src/config.js
require("dotenv").config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    MONGO_URI: process.env.MONGO_URI,
    REDIS_URL: process.env.REDIS_URL,
    BOT_PASSWORD: process.env.BOT_PASSWORD || "1234",
    GROUP_CHAT_ID: String(process.env.GROUP_CHAT_ID || ""),
    TZ: process.env.TZ || "Asia/Tashkent",
    AUTH_TTL_SECONDS: 60 * 60 * 24 * 2, // 2 kun
    WEBAPP_URL: process.env.WEBAPP_URL, // masalan: https://your-site.com
    PORT: process.env.PORT || 6060
};