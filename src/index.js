
// src/index.js (OPTIMAL + NO CRASH ON TELEGRAM API FAIL + DASH REALTIME)
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { createCustomerBot } = require("./customerBot");
const { connectDb } = require("./db");
const { createBot } = require("./bot");
const { TZ, BOT_TOKEN, CUSTOMER_BOT_TOKEN, REDIS_URL, PORT, WEBAPP_URL } = require("./config");

const { webappRoutes } = require("./routes/webapp");
const { createRealtime } = require("./services/realtime");
const { createDashboardRealtime } = require("./services/dashboardRealtime");
const { createReceiptRealtime } = require("./services/receiptRealtime");
const dns = require("dns");
require("./bootstrap/guard"); // pathni sizning strukturaga moslang
dns.setDefaultResultOrder("ipv4first");
process.env.TZ = TZ || "Asia/Tashkent";

function normalizeOrigin(url) {
    if (!url) return null;
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

async function safe(name, fn) {
    try {
        return await fn();
    } catch (e) {
        console.log(`⚠️ ${name} xato (server yiqilmaydi):`, e?.message || e);
        return null;
    }
}

(async () => {
    try {
        // ✅ DB — kritik
        await connectDb();

        const app = express();
        app.use(express.json({ limit: "1mb" }));

        // ✅ CORS (WEBAPP_URL origin)
        const webappOrigin = normalizeOrigin(WEBAPP_URL);

        app.use(
            cors({
                origin: (origin, cb) => {
                    if (!origin) return cb(null, true); // Postman / server-to-server
                    if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return cb(null, true);
                    if (webappOrigin && origin === webappOrigin) return cb(null, true);
                    return cb(new Error("CORS BLOCKED"), false);
                },
                credentials: true,
            })
        );

        const server = http.createServer(app);

        const io = new Server(server, {
            cors: { origin: "*", methods: ["GET", "POST"] },
        });

        global.io = io;

        // ✅ routes (1 marta!)
        app.use(
            "/api/webapp",
            webappRoutes({
                botToken: BOT_TOKEN,
                customerBotToken: CUSTOMER_BOT_TOKEN,
                io,
            })
        );

        app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

        // ✅ realtime (PUB/SUB) — kritik emas
        const realtime = createRealtime({ redisUrl: REDIS_URL, io });
        global.realtime = realtime;

        // ✅ DASHBOARD REALTIME
        const dashRT = createDashboardRealtime({ io, intervalMs: 2500 });
        dashRT.attachSocketHandlers();

        // ✅ receipt realtime
        const receiptRT = createReceiptRealtime({ io });
        global.receiptRT = receiptRT;

        // ✅ server listen
        const port = PORT || 6060;
        server.listen(port, () => console.log(`🌐 Backend server: ${port}`));

        // ✅ Admin bot — kritik emas
        const bot = await safe("createBot()", () => createBot());
        if (bot) console.log("🤖 Bot started");

        // ✅ Customer bot — kritik emas
        const customerBot = await safe("createCustomerBot()", () => createCustomerBot());
        if (customerBot) console.log("🎁 Customer Bot started");

        // ✅ ChatMenuButton — crash bo‘lishi mumkin, shuning uchun safe
        if (bot && WEBAPP_URL) {
            await safe("setChatMenuButton()", async () => {
                await bot.setChatMenuButton({
                    menu_button: {
                        type: "web_app",
                        text: "Открыть",
                        web_app: { url: WEBAPP_URL },
                    },
                });
                console.log("✅ ChatMenuButton set:", WEBAPP_URL);
            });
        }
    } catch (e) {
        console.error("❌ Start error (kritik):", e);
        process.exit(1);
    }
})();
