// guard.js
process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT_EXCEPTION:", err?.stack || err);
    // Bu yerda process.exit() QILMAYMIZ, log qilib qoldiramiz
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED_REJECTION:", reason);
});