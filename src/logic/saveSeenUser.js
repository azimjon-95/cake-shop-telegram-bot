// src/logic/saveSeenUser.js
// ✅ Har xabar kelganda foydalanuvchini saqlaymiz
// + Worker bo'lsa ismi/usernameni avtomatik yangilaymiz (ID:xxx bo'lsa)
const SeenTelegramUser = require("../models/SeenTelegramUser");
const Worker = require("../models/Worker");

async function saveSeenUser(msg) {
    const from = msg?.from;
    if (!from?.id) return;

    const fullName = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();

    // SeenTelegramUser — statistika uchun
    await SeenTelegramUser.findOneAndUpdate(
        { tgId: from.id },
        {
            $set: {
                username: from.username || "",
                fullName,
                lastSeenAt: new Date()
            }
        },
        { upsert: true }
    ).catch(() => {});

    // Worker bo'lsa — ismi "ID:xxx" shaklida qolgan bo'lsa yangilaymiz
    if (fullName) {
        await Worker.findOneAndUpdate(
            {
                tgId: from.id,
                $or: [
                    { fullName: { $regex: /^ID:\d+$/ } },  // "ID:123456" shaklida
                    { fullName: "" }
                ]
            },
            {
                $set: {
                    fullName,
                    username: from.username || ""
                }
            }
        ).catch(() => {});
    }
}

module.exports = { saveSeenUser };
