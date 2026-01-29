const { connectDb } = require("./db");
const { createBot } = require("./bot");
const { TZ } = require("./config");

process.env.TZ = TZ;

(async () => {
    try {
        await connectDb();
        await createBot();
        console.log("🤖 Bot started");

    } catch (e) {
        console.error("❌ Start error:", e);
        process.exit(1);
    }
})();
