// services/auth.js
const Redis = require("ioredis");
const { REDIS_URL, AUTH_TTL_SECONDS, BOT_PASSWORD } = require("../config");

// ✅ ioredis: auto reconnect bor, lekin baribir errorlarni ushlaymiz
const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 2,          // osilib qolmasin
    connectTimeout: 10000,
    retryStrategy: (times) => Math.min(times * 500, 5000), // 0.5s..5s
    enableReadyCheck: true,
});

let redisOk = false;

// ✅ RAM fallback (Redis o‘lsa ham bot ishlayveradi)
const mem = new Map();
function memSet(key, val, ttlSec) {
    mem.set(key, val);
    if (ttlSec) setTimeout(() => mem.delete(key), ttlSec * 1000).unref();
}
function memGet(key) {
    return mem.get(key) ?? null;
}
function memDel(key) {
    mem.delete(key);
}

redis.on("ready", () => { redisOk = true; console.log("[redis] ready"); });
redis.on("connect", () => console.log("[redis] connect"));
redis.on("reconnecting", () => { redisOk = false; console.log("[redis] reconnecting..."); });
redis.on("end", () => { redisOk = false; console.log("[redis] end"); });
redis.on("error", (e) => { redisOk = false; console.error("[redis] error:", e?.message || e); });

function authKey(userId) {
    return `auth:${userId}`;
}
function modeKey(userId) {
    return `mode:${userId}`;
}

async function safeGet(key) {
    if (!redisOk) return memGet(key);
    try {
        return await redis.get(key);
    } catch (e) {
        redisOk = false;
        console.error("[redis] GET failed:", e?.message || e);
        return memGet(key); // fallback
    }
}

async function safeSet(key, val, ttlSec) {
    if (!redisOk) return memSet(key, val, ttlSec);
    try {
        if (ttlSec) return await redis.set(key, val, "EX", ttlSec);
        return await redis.set(key, val);
    } catch (e) {
        redisOk = false;
        console.error("[redis] SET failed:", e?.message || e);
        return memSet(key, val, ttlSec); // fallback
    }
}

async function safeDel(key) {
    if (!redisOk) return memDel(key);
    try {
        return await redis.del(key);
    } catch (e) {
        redisOk = false;
        console.error("[redis] DEL failed:", e?.message || e);
        return memDel(key);
    }
}

async function isAuthed(userId) {
    const v = await safeGet(authKey(userId));
    return v === "1";
}

async function setAuthed(userId) {
    await safeSet(authKey(userId), "1", AUTH_TTL_SECONDS);
}

async function clearAuthed(userId) {
    await safeDel(authKey(userId));
}

async function setMode(userId, mode) {
    await safeSet(modeKey(userId), mode, AUTH_TTL_SECONDS);
}

async function getMode(userId) {
    return (await safeGet(modeKey(userId))) || null;
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
    checkPassword,
};