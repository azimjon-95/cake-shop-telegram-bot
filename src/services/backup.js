// src/services/backup.js
// ✅ Kunlik to'liq DB backup — barcha collectionlar JSON ga, Telegram gruppaga yuboradi
// Fayllar lokal saqlanmaydi (stream orqali yuboriladi)

const { Readable } = require("stream");
const os  = require("os");
const path = require("path");
const fs   = require("fs");

const Sale           = require("../models/Sale");
const Expense        = require("../models/Expense");
const Debt           = require("../models/Debt");
const Purchase       = require("../models/Purchase");
const Supplier       = require("../models/Supplier");
const Worker         = require("../models/Worker");
const Customer       = require("../models/Customer");
const Counter        = require("../models/Counter");
const ReceiptToken   = require("../models/ReceiptToken");
const Referral       = require("../models/Referral");
const SeenTelegramUser = require("../models/SeenTelegramUser");

const { BACKUP_CHAT_ID } = require("../config");

// ── Har bir collectiondan barcha hujjatlarni olamiz
const COLLECTIONS = [
  { name: "sales",            Model: Sale },
  { name: "expenses",         Model: Expense },
  { name: "debts",            Model: Debt },
  { name: "purchases",        Model: Purchase },
  { name: "suppliers",        Model: Supplier },
  { name: "workers",          Model: Worker },
  { name: "customers",        Model: Customer },
  { name: "counters",         Model: Counter },
  { name: "receipt_tokens",   Model: ReceiptToken },
  { name: "referrals",        Model: Referral },
  { name: "seen_tg_users",    Model: SeenTelegramUser },
];

// ── Backup obyektini yaratish
async function buildBackup() {
  const backup = {
    meta: {
      createdAt: new Date().toISOString(),
      tz: process.env.TZ || "Asia/Tashkent",
      version: "1.0",
    },
    data: {},
  };

  let totalDocs = 0;

  for (const { name, Model } of COLLECTIONS) {
    try {
      const docs = await Model.find().lean();
      backup.data[name] = docs;
      totalDocs += docs.length;
    } catch (e) {
      backup.data[name] = [];
      backup.meta[`${name}_error`] = e.message;
    }
  }

  backup.meta.totalDocuments = totalDocs;
  return backup;
}

// ── Telegram gruppaga yuborish (vaqtinchalik fayl orqali)
async function sendBackupToTelegram(bot) {
  if (!BACKUP_CHAT_ID) {
    console.warn("[backup] BACKUP_CHAT_ID yo'q — backup yuborilmadi");
    return { ok: false, reason: "BACKUP_CHAT_ID not set" };
  }

  const now  = new Date();
  const pad  = v => String(v).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const fileName = `totli_backup_${dateStr}_${timeStr}.json`;

  let backup;
  try {
    backup = await buildBackup();
  } catch (e) {
    console.error("[backup] buildBackup error:", e.message);
    return { ok: false, reason: e.message };
  }

  const json = JSON.stringify(backup, null, 2);
  const totalDocs = backup.meta.totalDocuments;

  // Vaqtinchalik fayl — /tmp da, lokal papkani ifloslantirmaydi
  const tmpPath = path.join(os.tmpdir(), fileName);

  try {
    fs.writeFileSync(tmpPath, json, "utf8");

    const caption =
      `📦 <b>TOTLI DB Backup</b>\n\n` +
      `📅 Sana: <b>${dateStr}</b>\n` +
      `🕐 Vaqt: <b>${timeStr.replace("-", ":")}</b>\n` +
      `📊 Jami hujjatlar: <b>${totalDocs}</b>\n` +
      `📁 Fayl: <code>${fileName}</code>\n\n` +
      Object.entries(backup.data)
        .map(([k, v]) => `• ${k}: ${v.length} ta`)
        .join("\n");

    await bot.sendDocument(
      BACKUP_CHAT_ID,
      tmpPath,
      { caption, parse_mode: "HTML" },
      { filename: fileName, contentType: "application/json" }
    );

    console.log(`[backup] ✅ ${fileName} yuborildi (${totalDocs} docs)`);
    return { ok: true, fileName, totalDocs };

  } catch (e) {
    console.error("[backup] sendDocument error:", e.message);
    return { ok: false, reason: e.message };
  } finally {
    // Vaqtinchalik faylni o'chiramiz
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

// ── Backup fayldan DB ni tiklash (migrate.js dan chaqiriladi)
async function restoreFromBackup(filePath) {
  const raw  = fs.readFileSync(filePath, "utf8");
  const bk   = JSON.parse(raw);

  if (!bk?.data) throw new Error("Noto'g'ri backup format");

  const results = {};

  for (const { name, Model } of COLLECTIONS) {
    const docs = bk.data[name];
    if (!Array.isArray(docs) || docs.length === 0) {
      results[name] = { skipped: true };
      continue;
    }

    try {
      // insertMany — conflict bo'lsa o'tkazib ketadi
      const inserted = await Model.insertMany(docs, {
        ordered: false,
        rawResult: false,
      }).catch(e => {
        // Duplicate key — normalda bo'ladi (allaqachon bor)
        const dup = e?.writeErrors?.length || 0;
        return { acknowledged: true, insertedCount: docs.length - dup };
      });

      results[name] = {
        total: docs.length,
        inserted: inserted?.insertedCount ?? docs.length,
      };
    } catch (e) {
      results[name] = { error: e.message };
    }
  }

  return results;
}

module.exports = { sendBackupToTelegram, restoreFromBackup, buildBackup };
