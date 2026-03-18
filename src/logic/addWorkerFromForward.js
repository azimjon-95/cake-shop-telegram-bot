const Worker = require("../models/Worker");

function getForwardUser(msg) {
    const fwd =
        msg?.forward_from ||
        msg?.reply_to_message?.forward_from ||
        null;

    return fwd;
}

async function addWorkerFromForward(msg) {
    const user = getForwardUser(msg);

    if (!user?.id) {
        throw new Error(
            "Forward qilingan xabardan foydalanuvchi aniqlanmadi. User xabarini to‘g‘ridan-to‘g‘ri forward qiling."
        );
    }

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");

    const worker = await Worker.findOneAndUpdate(
        { tgId: user.id },
        {
            $set: {
                username: user.username || "",
                fullName,
                isActive: true,
                canUseWebApp: true,
            },
            $setOnInsert: {
                role: "worker",
            },
        },
        { upsert: true, new: true }
    );

    return worker;
}

module.exports = { addWorkerFromForward };