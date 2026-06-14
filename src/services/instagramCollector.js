// src/services/instagramCollector.js
// Telegram guruhdan kunlik 5 ta tort rasm yig'ib Instagram ga joylaydi

const fs   = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const schedule = require("node-schedule");

const TMP_DIR = path.join(__dirname, "../../tmp_insta");

// Bugun yig'ilgan rasmlar (xotira)
const dailyPhotos = [];

// ── Papka tayyor qilish ──────────────────────────────
function ensureTmpDir() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ── Rasmni diskka saqlash ────────────────────────────
async function savePhoto(bot, fileId, index) {
    ensureTmpDir();
    const file    = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    const https    = require("https");
    const savePath = path.join(TMP_DIR, `tort_${Date.now()}_${index}.jpg`);

    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(savePath);
        https.get(fileUrl, (res) => {
            res.pipe(out);
            out.on("finish", () => { out.close(); resolve(savePath); });
        }).on("error", reject);
    });
}

// ── Python poster chaqirish ──────────────────────────
function runPoster(imagePaths) {
    return new Promise((resolve, reject) => {
        const script = path.join(__dirname, "instagramPoster.py");
        const env    = { ...process.env };

        execFile("python3", [script, ...imagePaths], { env }, (err, stdout, stderr) => {
            if (stdout) console.log("[Instagram]", stdout);
            if (stderr) console.error("[Instagram ERR]", stderr);
            if (err)    reject(err);
            else        resolve();
        });
    });
}

// ── Vaqtinchalik fayllarni o'chirish ────────────────
function cleanTmp(paths) {
    paths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
}

// ── Rasm qabul qilish (bot handler dan chaqiriladi) ──
async function onGroupPhoto(bot, msg) {
    // Faqat belgilangan guruhdan
    const GROUP_ID = process.env.GROUP_CHAT_ID;
    if (String(msg.chat.id) !== String(GROUP_ID)) return;
    if (!msg.photo) return;

    // Eng katta o'lchamli rasmni ol
    const photo  = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    // Bir kunda 5 tadan ko'p olmaylik
    if (dailyPhotos.length >= 5) return;

    try {
        const savePath = await savePhoto(bot, fileId, dailyPhotos.length);
        dailyPhotos.push(savePath);
        console.log(`📸 Rasm saqlandi: ${dailyPhotos.length}/5`);

        // 5 ta to'lsa — darhol joyla
        if (dailyPhotos.length === 5) {
            await publishNow(bot);
        }
    } catch (e) {
        console.error("[instagramCollector] savePhoto xatosi:", e?.message);
    }
}

// ── Instagram ga joylash ─────────────────────────────
async function publishNow(bot) {
    if (dailyPhotos.length === 0) {
        console.log("[Instagram] Joylash uchun rasm yo'q");
        return;
    }

    const toPost = [...dailyPhotos];
    dailyPhotos.length = 0; // reset

    console.log(`🚀 Instagram ga joylanmoqda: ${toPost.length} ta rasm...`);

    try {
        await runPoster(toPost);

        // Guruhga xabar
        if (process.env.GROUP_CHAT_ID) {
            await bot.sendMessage(
                process.env.GROUP_CHAT_ID,
                `✅ Instagram ga joylandi!\n📸 ${toPost.length} ta rasm\n📌 Post + ${toPost.length} ta Story`
            ).catch(() => {});
        }
    } catch (e) {
        console.error("[Instagram] Joylash xatosi:", e?.message);
        if (process.env.GROUP_CHAT_ID) {
            await bot.sendMessage(
                process.env.GROUP_CHAT_ID,
                `❌ Instagram joylashda xatolik: ${e?.message}`
            ).catch(() => {});
        }
    } finally {
        cleanTmp(toPost);
    }
}

// ── Kunlik scheduler ─────────────────────────────────
// Har kuni soat 20:00 da (nechta rasm bo'lsa ham joylaydi)
function scheduleInstagramPost(bot) {
    schedule.scheduleJob("0 20 * * *", async () => {
        console.log("[Instagram] Kunlik soat 20:00 — joylash boshlandi");
        if (dailyPhotos.length === 0) {
            console.log("[Instagram] Bugun rasm yo'q, o'tkazib yuborildi");
            return;
        }
        await publishNow(bot);
    });

    // Yarim tunda counter reset (yangi kun uchun)
    schedule.scheduleJob("1 0 * * *", () => {
        dailyPhotos.length = 0;
        console.log("[Instagram] Kunlik counter reset");
    });

    console.log("📅 Instagram scheduler: har kuni 20:00 da joylaydi");
}

module.exports = { onGroupPhoto, scheduleInstagramPost, publishNow };
