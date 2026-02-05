const { connectDb } = require("./db");
const { createBot } = require("./bot/createBot");
const { TZ } = require("./config");

process.env.TZ = TZ;

(async () => {
    try {
        await connectDb();
        await createBot(); // ✅ botni shu yerda olamiz
        console.log("🤖 Bot started");
    } catch (e) {
        console.error("❌ Start error:", e);
        process.exit(1);
    }
})();
