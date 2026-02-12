const Redis = require("ioredis");
const { REDIS_URL, AUTH_TTL_SECONDS, BOT_PASSWORD } = require("../config");

const redis = new Redis(REDIS_URL);

function authKey(userId) {
    return `auth:${userId}`;
}
function modeKey(userId) {
    return `mode:${userId}`;
}

async function isAuthed(userId) {
    const v = await redis.get(authKey(userId));
    return v === "1";
}

async function setAuthed(userId) {
    await redis.set(authKey(userId), "1", "EX", AUTH_TTL_SECONDS);
}

async function clearAuthed(userId) {
    await redis.del(authKey(userId));
}

async function setMode(userId, mode) {
    await redis.set(modeKey(userId), mode, "EX", AUTH_TTL_SECONDS);
}

async function getMode(userId) {
    return (await redis.get(modeKey(userId))) || null;
}

function checkPassword(text) {
    return String(text || "").trim() === String(BOT_PASSWORD);
}

module.exports = {
    redis,
    isAuthed,
    setAuthed,
    clearAuthed,
    setMode,
    getMode,
    checkPassword
};