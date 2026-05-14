// migrate.js
require("dotenv").config();
const { MongoClient } = require("mongodb");

// ⚠️ .env faylida quyidagilarni sozlang:
// OLD_MONGO_URI=mongodb+srv://...
// NEW_MONGO_URI=mongodb+srv://...
const oldUri = process.env.OLD_MONGO_URI;
const newUri = process.env.NEW_MONGO_URI;

if (!oldUri || !newUri) {
    console.error("❌ OLD_MONGO_URI yoki NEW_MONGO_URI .env da yo'q!");
    process.exit(1);
}

const dbName = process.env.MIGRATE_DB_NAME || "test";

async function migrate() {
  const oldClient = new MongoClient(oldUri);
  const newClient = new MongoClient(newUri);

  try {
    await oldClient.connect();
    await newClient.connect();

    const oldDb = oldClient.db(dbName);
    const newDb = newClient.db(dbName);

    const collections = await oldDb.listCollections().toArray();

    for (const { name } of collections) {
      console.log(`⏳ ${name} collection ko‘chirilmoqda...`);

      const docs = await oldDb.collection(name).find().toArray();

      if (docs.length > 0) {
        await newDb.collection(name).deleteMany({}); // Avval tozalash (agar kerak bo‘lsa)
        await newDb.collection(name).insertMany(docs);
        console.log(`✅ ${name} (${docs.length} ta hujjat) ko‘chirildi`);
      } else {
        console.log(`⚠️ ${name} bo‘sh, o‘tkazib yuborildi`);
      }
    }

    console.log("🎉 Migration tugadi!");
  } catch (err) {
    console.error("❌ Xato:", err);
  } finally {
    await oldClient.close();
    await newClient.close();
  }
}

migrate();
