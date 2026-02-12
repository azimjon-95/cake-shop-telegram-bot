// src/index.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { connectDb } = require("./db");
const { createBot } = require("./bot");
const { TZ, BOT_TOKEN, REDIS_URL, PORT, WEBAPP_URL } = require("./config");

const { webappRoutes } = require("./routes/webapp");
const { createRealtime } = require("./services/realtime");

process.env.TZ = TZ;

function normalizeOrigin(url) {
    if (!url) return null;
    try {
        return new URL(url).origin; // https://domain.com
    } catch {
        return null;
    }
}

(async () => {
    try {
        // ✅ 1) DB
        await connectDb();
        // ✅ 2) Express + HTTP
        const app = express();
        app.use(express.json({ limit: "1mb" }));

        // ✅ CORS (faqat webapp domeniga ruxsat)
        const webappOrigin = normalizeOrigin(WEBAPP_URL);
        app.use(
            cors({
                origin: webappOrigin ? [webappOrigin] : true,
                credentials: true,
            })
        );

        const server = http.createServer(app);

        // ✅ 3) Socket.IO (realtime)
        const io = new Server(server, {
            cors: {
                origin: webappOrigin ? [webappOrigin] : "*",
                methods: ["GET", "POST"],
            },
        });

        // global io (xohlasangiz flowlarda io.emit ishlatasiz)
        global.io = io;

        // ✅ 4) API routes (Telegram WebApp initData verify)
        // webappRoutes ichida verifyTgWebApp(botToken) turadi
        app.use("/api/webapp", webappRoutes({ botToken: BOT_TOKEN, io }));

        // ✅ 5) Health check
        app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

        // ✅ 6) Realtime (Redis -> Socket)
        const realtime = createRealtime({ redisUrl: REDIS_URL, io });
        global.realtime = realtime;

        // ✅ 7) Start server
        const port = PORT || 3000;
        server.listen(port, () => console.log(`🌐 Backend server: ${port}`));

        // ✅ 8) Bot
        const bot = await createBot();
        console.log("🤖 Bot started");

        // ✅ 9) Bot profilidagi "Открыть" (Mini App)
        // BU URL - frontend (Vercel) bo'ladi
        if (!WEBAPP_URL) {
            console.warn("⚠️ WEBAPP_URL yo'q. Bot menu tugmasi ishlamaydi.");
        } else {
            await bot.setChatMenuButton({
                menu_button: {
                    type: "web_app",
                    text: "Открыть",
                    web_app: { url: WEBAPP_URL },
                },
            });
            console.log("✅ ChatMenuButton set:", WEBAPP_URL);
        }
    } catch (e) {
        console.error("❌ Start error:", e);
        process.exit(1);
    }
})();









// // src/index.js
// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");

// const { connectDb } = require("./db");
// const { createBot } = require("./bot");
// const { TZ, BOT_TOKEN, REDIS_URL } = require("./config");
// const { webappRoutes } = require("./routes/webapp");
// const { createRealtime } = require("./services/realtime");
// process.env.TZ = TZ;

// (async () => {
//     try {
//         await connectDb();
//         const bot = await createBot();
//         console.log("🤖 Bot started");
//         await bot.setChatMenuButton({
//             menu_button: {
//                 type: "web_app",
//                 text: "Открыть",
//                 web_app: {
//                     url: "https://your-site.com"
//                 }
//             }
//         });

//     } catch (e) {
//         console.error("❌ Start error:", e);
//         process.exit(1);
//     }
// })();