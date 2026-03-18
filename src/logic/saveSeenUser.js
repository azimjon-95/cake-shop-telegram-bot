const SeenTelegramUser = require("../models/SeenTelegramUser");

async function saveSeenUser(msg) {

    const from = msg?.from;
    if (!from?.id) return;

    await SeenTelegramUser.findOneAndUpdate(
        { tgId: from.id },
        {
            $set: {
                username: from.username || "",
                fullName: [from.first_name, from.last_name].filter(Boolean).join(" "),
                lastSeenAt: new Date()
            }
        },
        { upsert: true }
    );
}

module.exports = { saveSeenUser };