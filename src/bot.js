// src/bot.js
const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN } = require("./config");

const { onStart } = require("./handlers/onStart");
const { onCallback } = require("./handlers/onCallback");
const { onMessage } = require("./handlers/onMessage");

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");

    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // bot.onText(/\/start/i, (msg) => onStart(bot, msg));
    bot.on("callback_query", (q) => onCallback(bot, q));
    bot.on("message", (msg) => onMessage(bot, msg));

    return bot;
}

module.exports = { createBot };