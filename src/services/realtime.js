const { createClient } = require("redis");

const CHANNEL = "dashboard_events";

function createRealtime({ redisUrl, io }) {
    const pub = createClient({ url: redisUrl });
    const sub = createClient({ url: redisUrl });

    pub.connect().catch(() => { });
    sub.connect().catch(() => { });

    sub.subscribe(CHANNEL, (msg) => {
        try {
            const data = JSON.parse(msg);
            io.emit("dash:update", data); // hamma webapp klientlarga
        } catch { }
    });

    const publish = async (payload) => {
        try {
            await pub.publish(CHANNEL, JSON.stringify(payload));
        } catch { }
    };

    return { publish };
}

module.exports = { createRealtime };
