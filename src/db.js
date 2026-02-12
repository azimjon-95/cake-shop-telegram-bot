// src/db.js
const mongoose = require("mongoose");
const { MONGO_URI } = require("./config");

async function connectDb() {
    if (!MONGO_URI) throw new Error("MONGO_URI yo'q");
    mongoose.set("strictQuery", true);

    await mongoose.connect(MONGO_URI, {
        autoIndex: true
    });

    console.log("✅ MongoDB connected");
}

module.exports = { connectDb, mongoose };
