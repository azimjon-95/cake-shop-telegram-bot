// src/restore.js — Backup fayldan yangi DB ni tiklash
// Ishlatish: node src/restore.js ./totli_backup_2025-04-10.json
//
// Bu skript:
//   1) Backup JSON faylini o'qiydi
//   2) .env dagi MONGO_URI ga ulanadi
//   3) Barcha collectionlarga insertMany qiladi (duplicate skip)
//   4) Natijani chiqaradi

require("dotenv").config();
const path = require("path");
const { mongoose } = require("./db");
const { restoreFromBackup } = require("./services/backup");

const file = process.argv[2];

if (!file) {
  console.error("❌ Fayl ko'rsatilmadi!\nMisol: node src/restore.js ./totli_backup_2025-04-10_23-30.json");
  process.exit(1);
}

const absPath = path.resolve(file);
console.log(`📂 Fayl: ${absPath}`);
console.log(`🔗 DB: ${process.env.MONGO_URI?.slice(0, 40)}...`);
console.log("⏳ Tiklanmoqda...\n");

async function run() {
  try {
    await mongoose.connection.asPromise();
    console.log("✅ MongoDB ulandi\n");

    const results = await restoreFromBackup(absPath);

    let totalInserted = 0;
    console.log("📊 NATIJALAR:");
    console.log("─".repeat(40));
    for (const [col, res] of Object.entries(results)) {
      if (res.skipped) {
        console.log(`  ${col.padEnd(20)} — bo'sh, o'tkazildi`);
      } else if (res.error) {
        console.log(`  ${col.padEnd(20)} — ❌ XATO: ${res.error}`);
      } else {
        console.log(`  ${col.padEnd(20)} — ✅ ${res.inserted}/${res.total} saqlandi`);
        totalInserted += res.inserted || 0;
      }
    }
    console.log("─".repeat(40));
    console.log(`\n✅ Jami saqlandi: ${totalInserted} ta hujjat`);

  } catch (e) {
    console.error("❌ Xatolik:", e.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
