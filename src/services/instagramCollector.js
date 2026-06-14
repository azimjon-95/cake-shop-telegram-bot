// src/services/instagramCollector.js
// Telegram guruhdan kunlik tort rasmlarini yig'ib Instagram ga joylaydi
// Faqat INSTA_ALLOWED_USER_IDS dagi foydalanuvchilar rasmlaridan olinadi

const fs       = require("fs");
const path     = require("path");
const https    = require("https");
const { execFile } = require("child_process");
const schedule = require("node-schedule");

const TMP_DIR = path.join(__dirname, "../../tmp_insta");

// Bugun yig'ilgan rasmlar
const dailyPhotos = [];

// ── .env dan ruxsat berilgan user ID larni o'qish ────
// .env da: INSTA_ALLOWED_USER_IDS=123456789,987654321,111222333,444555666
function getAllowedUserIds() {
    const raw = process.env.INSTA_ALLOWED_USER_IDS || "";
    return raw.split(",").map(x => x.trim()).filter(Boolean);
}

// ── Papka tayyor qilish ──────────────────────────────
function ensureTmpDir() {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ── Rasmni diskka saqlash ────────────────────────────
async function savePhoto(bot, fileId, index) {
    ensureTmpDir();
    const file    = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
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
        execFile("python3", [script, ...imagePaths], { env: process.env }, (err, stdout, stderr) => {
            if (stdout) console.log("[Instagram]", stdout.trim());
            if (stderr) console.error("[Instagram ERR]", stderr.trim());
            if (err)    reject(err);
            else        resolve();
        });
    });
}

// ── Vaqtinchalik fayllarni o'chirish ────────────────
function cleanTmp(paths) {
    paths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
}

// ── Rasm qabul qilish (bot.on("message") dan chaqiriladi) ──
async function onGroupPhoto(bot, msg) {
    const GROUP_ID       = process.env.INSTA_GROUP_ID || process.env.GROUP_CHAT_ID;
    const allowedIds     = getAllowedUserIds();
    const senderId       = String(msg.from?.id || "");

    // Faqat belgilangan guruhdan
    if (String(msg.chat.id) !== String(GROUP_ID)) return;
    if (!msg.photo) return;

    // Faqat ruxsat berilgan user lardan
    if (allowedIds.length > 0 && !allowedIds.includes(senderId)) {
        console.log(`[Instagram] User ${senderId} ruxsatsiz — rasm o'tkazib yuborildi`);
        return;
    }

    // Bugun maksimum 5 ta
    if (dailyPhotos.length >= 5) return;

    // Eng katta o'lchamli rasmni ol
    const photo  = msg.photo[msg.photo.length - 1];

    try {
        const savePath = await savePhoto(bot, photo.file_id, dailyPhotos.length);
        dailyPhotos.push(savePath);
        console.log(`📸 Rasm saqlandi (${senderId}): ${dailyPhotos.length}/5`);
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
    dailyPhotos.length = 0;

    const GROUP_ID = process.env.INSTA_GROUP_ID || process.env.GROUP_CHAT_ID;
    console.log(`🚀 Instagram ga joylanmoqda: ${toPost.length} ta rasm...`);

    try {
        await runPoster(toPost);

        if (GROUP_ID) {
            await bot.sendMessage(
                GROUP_ID,
                `✅ Instagram ga joylandi!\n📸 ${toPost.length} ta rasm\n📌 1 ta Post + ${toPost.length} ta Story`
            ).catch(() => {});
        }
    } catch (e) {
        console.error("[Instagram] Joylash xatosi:", e?.message);
        if (GROUP_ID) {
            await bot.sendMessage(
                GROUP_ID,
                `❌ Instagram joylashda xatolik:\n${e?.message}`
            ).catch(() => {});
        }
    } finally {
        cleanTmp(toPost);
    }
}

// ── Kunlik scheduler ─────────────────────────────────
// INSTA_POST_HOUR — soat (default: 20), Asia/Tashkent vaqti
function scheduleInstagramPost(bot) {
    const hour = Number(process.env.INSTA_POST_HOUR || 20);

    // Har kuni belgilangan soatda post
    schedule.scheduleJob(`0 ${hour} * * *`, async () => {
        console.log(`[Instagram] Soat ${hour}:00 — joylash boshlandi`);
        await publishNow(bot);
    });

    // Yarim tunda counter reset
    schedule.scheduleJob("1 0 * * *", () => {
        dailyPhotos.length = 0;
        console.log("[Instagram] Kunlik counter reset");
    });

    console.log(`📅 Instagram scheduler: har kuni ${hour}:00 da joylaydi`);
}

module.exports = { onGroupPhoto, scheduleInstagramPost, publishNow };
