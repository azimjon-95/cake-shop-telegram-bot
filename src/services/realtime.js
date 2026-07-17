// src/services/realtime.js
// Redis Pub/Sub — Redis yo'q bo'lsa jim ishlaydi, log spam yo'q
const Redis = require("ioredis");
const CHANNEL = "dashboard_events";

function createRealtime({ redisUrl, io }) {
    let pub = null;
    let sub = null;
    let pubOk = false;
    let subOk = false;
    let warned = false;

    const opts = {
        lazyConnect:          true,
        maxRetriesPerRequest: 1,
        connectTimeout:       5000,
        commandTimeout:       3000,
        enableReadyCheck:     true,
        retryStrategy(times) {
            if (times === 1 && !warned) {
                warned = true;
                console.log("[realtime] Redis yo'q — Pub/Sub o'chirilgan, Socket.IO to'g'ridan ishlaydi");
            }
            return Math.min(times * 10_000, 60_000); // 10s..60s — sekin, spam yo'q
        },
    };

    // ── PUB ──────────────────────────────────────────────
    pub = new Redis(redisUrl, opts);
    pub.on("ready",  () => { pubOk = true;  });
    pub.on("error",  () => { pubOk = false; }); // sukunat
    pub.on("end",    () => { pubOk = false; });
    pub.connect().catch(() => {}); // xatoni yutamiz

    // ── SUB ──────────────────────────────────────────────
    sub = new Redis(redisUrl, opts);
    sub.on("ready", async () => {
        subOk = true;
        try {
            await sub.subscribe(CHANNEL, (msg) => {
                try {
                    const data = JSON.parse(msg);
                    io.emit("dash:update", data);
                } catch {}
            });
        } catch {}
    });
    sub.on("error", () => { subOk = false; }); // sukunat
    sub.on("end",   () => { subOk = false; });
    sub.connect().catch(() => {});

    // ── PUBLISH — Redis yo'q bo'lsa Socket.IO ga to'g'ri yuboradi ──
    const publish = async (payload) => {
        if (pubOk) {
            try {
                await pub.publish(CHANNEL, JSON.stringify(payload));
                return;
            } catch { pubOk = false; }
        }
        // Fallback: to'g'ridan Socket.IO ga emit
        try { io.emit("dash:update", payload); } catch {}
    };

    const close = async () => {
        try { pub.disconnect(); } catch {}
        try { sub.disconnect(); } catch {}
    };

    return { publish, close };
}

module.exports = { createRealtime };
