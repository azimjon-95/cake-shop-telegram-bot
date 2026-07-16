// src/services/auth.js
// Redis + RAM fallback — Redis o'lsa ham bot to'liq ishlaydi
// Barcha redis.get/set/del chaqiruvlari avtomatik fallback ga o'tadi

const Redis = require("ioredis");
const { REDIS_URL, AUTH_TTL_SECONDS, BOT_PASSWORD } = require("../config");
const Worker = require("../models/Worker");

// ═══════════════════════════════════════════════════════
// 1. RAM STORE — Redis o'lsa bu ishlaydi
// ═══════════════════════════════════════════════════════
const memStore = new Map(); // key → { value, expireAt }

const mem = {
    get(key) {
        const entry = memStore.get(key);
        if (!entry) return null;
        if (entry.expireAt && Date.now() > entry.expireAt) {
            memStore.delete(key);
            return null;
        }
        return entry.value;
    },
    set(key, value, mode, ttlSec) {
        const expireAt = ttlSec ? Date.now() + ttlSec * 1000 : null;
        memStore.set(key, { value, expireAt });
        // TTL garbage collect
        if (ttlSec) {
            setTimeout(() => memStore.delete(key), ttlSec * 1000).unref();
        }
        return "OK";
    },
    del(...keys) {
        keys.forEach(k => memStore.delete(k));
        return keys.length;
    },
};

// ═══════════════════════════════════════════════════════
// 2. REDIS ulanish — aggressiv xato bostiriladi
// ═══════════════════════════════════════════════════════
let redisOk    = false;
let redisClient = null;

function createRedisClient() {
    const client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout:       5000,
        commandTimeout:       3000,
        enableReadyCheck:     true,
        lazyConnect:          true,   // avtomatik ulanmaydi — qo'lda connect()
        retryStrategy(times) {
            // Har 10 soniyada qayta urinadi, lekin logni spamlamaydi
            if (times === 1) console.log("[redis] Ulanish yo'q — RAM fallback faol");
            return Math.min(times * 2000, 30_000);
        },
    });

    client.on("ready",        ()  => { redisOk = true;  console.log("[redis] ✅ ulandi"); });
    client.on("error",        ()  => { redisOk = false; });   // sukunat — spam yo'q
    client.on("reconnecting", ()  => { redisOk = false; });
    client.on("end",          ()  => { redisOk = false; });

    // Ulanishga harakat qilamiz — muvaffaqiyatsiz bo'lsa ham davom etamiz
    client.connect().catch(() => {
        console.log("[redis] ⚠️  Redis yo'q — RAM fallback bilan ishlaydi");
    });

    return client;
}

redisClient = createRedisClient();

// ═══════════════════════════════════════════════════════
// 3. SAFE WRAPPERS — Redis yoki RAM, xatolik yo'q
// ═══════════════════════════════════════════════════════
async function safeGet(key) {
    if (!redisOk) return mem.get(key);
    try {
        const val = await redisClient.get(key);
        return val;
    } catch {
        redisOk = false;
        return mem.get(key);
    }
}

async function safeSet(key, value, ...args) {
    // args = ["EX", ttlSec]  yoki []
    const [mode, ttl] = args;
    // RAM ga ham yozamiz — sinkronlash uchun
    mem.set(key, value, mode, ttl);

    if (!redisOk) return "OK";
    try {
        if (mode && ttl) return await redisClient.set(key, value, mode, ttl);
        return await redisClient.set(key, value);
    } catch {
        redisOk = false;
        return "OK"; // RAM da allaqachon yozilgan
    }
}

async function safeDel(...keys) {
    keys.forEach(k => mem.del(k));
    if (!redisOk) return keys.length;
    try {
        return await redisClient.del(...keys);
    } catch {
        redisOk = false;
        return keys.length;
    }
}

// ═══════════════════════════════════════════════════════
// 4. PROXY REDIS — barcha eski redis.get/set/del chaqiruvlari
//    avtomatik safe wrapper dan o'tadi
//    Hech bir faylda import o'zgartirish shart emas!
// ═══════════════════════════════════════════════════════
const redis = new Proxy(redisClient, {
    get(target, prop) {
        if (prop === "get")  return safeGet;
        if (prop === "set")  return safeSet;
        if (prop === "del")  return safeDel;
        // Qolgan metodlar (keys, expire, ...) — originaldan
        const val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
    }
});

// ═══════════════════════════════════════════════════════
// 5. AUTH FUNKSIYALAR
// ═══════════════════════════════════════════════════════
function authKey(userId) { return `auth:${userId}`; }
function modeKey(userId) { return `mode:${userId}`; }

async function isAuthed(userId) {
    return (await safeGet(authKey(userId))) === "1";
}
async function setAuthed(userId) {
    await safeSet(authKey(userId), "1", "EX", AUTH_TTL_SECONDS);
}
async function clearAuthed(userId) {
    await safeDel(authKey(userId));
}
async function setMode(userId, mode) {
    await safeSet(modeKey(userId), mode, "EX", AUTH_TTL_SECONDS);
}
async function getMode(userId) {
    return (await safeGet(modeKey(userId))) || null;
}

async function checkPassword(userId, text) {
    const worker = await Worker.findOne({ tgId: userId, isActive: true }).lean();
    if (worker) return true;
    return String(text || "").trim() === String(BOT_PASSWORD || "").trim();
}

// ═══════════════════════════════════════════════════════
// STATUS — monitoring uchun
// ═══════════════════════════════════════════════════════
function isRedisAlive() { return redisOk; }

module.exports = {
    redis,          // Proxy — barcha redis.get/set/del safe
    isAuthed,
    setAuthed,
    clearAuthed,
    setMode,
    getMode,
    checkPassword,
    isRedisAlive,
};
