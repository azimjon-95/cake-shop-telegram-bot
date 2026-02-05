// src/bot/createBot.js
const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN, CHANNEL_ID } = require("../config");

const { onMessage } = require("../handlers/onMessage");
const { onCallback } = require("../handlers/onCallback");

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");

    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    // handlerlar
    bot.on("callback_query", (q) => onCallback(bot, q));
    bot.on("message", (msg) => onMessage(bot, msg, { CHANNEL_ID }));

    return bot;
}

module.exports = { createBot };