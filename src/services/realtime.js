// services/realtime.js
const { createClient } = require("redis");
const CHANNEL = "dashboard_events";

function attachRedisLogs(client, name) {
    client.on("error", (e) => console.error(`[${name}] error:`, e?.message || e));
    client.on("connect", () => console.log(`[${name}] connect`));
    client.on("ready", () => console.log(`[${name}] ready`));
    client.on("reconnecting", () => console.log(`[${name}] reconnecting...`));
    client.on("end", () => console.log(`[${name}] end`));
}

async function safeConnect(client, name) {
    try {
        if (!client.isOpen) await client.connect();
    } catch (e) {
        console.error(`[${name}] connect failed:`, e?.message || e);
    }
}

function createRealtime({ redisUrl, io }) {
    // ✅ reconnect strategy
    const pub = createClient({
        url: redisUrl,
        socket: {
            keepAlive: 10000,
            reconnectStrategy: (retries) => Math.min(1000 * retries, 10000), // 1s..10s
        },
    });

    const sub = createClient({
        url: redisUrl,
        socket: {
            keepAlive: 10000,
            reconnectStrategy: (retries) => Math.min(1000 * retries, 10000),
        },
    });

    attachRedisLogs(pub, "redis_pub");
    attachRedisLogs(sub, "redis_sub");

    // ✅ background connect (lekin xatoni yutmaymiz)
    safeConnect(pub, "redis_pub");
    safeConnect(sub, "redis_sub").then(async () => {
        // ✅ subscribe faqat connectdan keyin
        try {
            await sub.subscribe(CHANNEL, (msg) => {
                try {
                    const data = JSON.parse(msg);
                    io.emit("dash:update", data);
                } catch (e) {
                    console.error("[redis_sub] bad JSON:", e?.message || e);
                }
            });
            console.log(`[redis_sub] subscribed: ${CHANNEL}`);
        } catch (e) {
            console.error("[redis_sub] subscribe failed:", e?.message || e);
        }
    });

    const publish = async (payload) => {
        try {
            // publish payti ulanmagan bo‘lsa ulab ko‘ramiz
            if (!pub.isOpen) await safeConnect(pub, "redis_pub");
            if (!pub.isOpen) return; // ulana olmasa jim qaytamiz (xohlasangiz log qiling)

            await pub.publish(CHANNEL, JSON.stringify(payload));
        } catch (e) {
            console.error("[redis_pub] publish failed:", e?.message || e);
        }
    };

    // ✅ server yopilganda toza close
    const close = async () => {
        try { if (sub.isOpen) await sub.quit(); } catch { }
        try { if (pub.isOpen) await pub.quit(); } catch { }
    };

    return { publish, close };
}

module.exports = { createRealtime };