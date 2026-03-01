// src/handlers/customerStart.js
const ReceiptToken = require("../models/ReceiptToken");
const Customer = require("../models/Customer");
const { GROUP_ID, GROUP_INVITE_LINK, WEBAPP_URL } = require("../config");

const { parseStartParam, applyReferral } = require("../services/referral");

function getName(msg) {
    const u = msg.from || {};
    return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.username || String(u.id);
}

async function isMember(bot, tgId) {
    if (!GROUP_ID) return true;
    try {
        const m = await bot.getChatMember(GROUP_ID, tgId);
        const st = m?.status;
        return st && st !== "left" && st !== "kicked";
    } catch {
        return false;
    }
}

async function ensureCustomer(msg) {
    const tgId = msg.from.id;
    const tgName = getName(msg);
    const doc = await Customer.findOneAndUpdate(
        { tgId },
        { $set: { tgName, updatedAt: new Date() } },
        { new: true, upsert: true }
    );
    return doc;
}

async function redeemOnce(token, tgId) {
    const doc = await ReceiptToken.findOne({ token });
    if (!doc) return { ok: false, code: "NOT_FOUND" };
    if (doc.status === "REDEEMED") return { ok: false, code: "USED" };

    doc.status = "REDEEMED";
    doc.redeemedByTgId = tgId;
    doc.redeemedAt = new Date();
    await doc.save();

    return { ok: true, tokenDoc: doc };
}

async function onCustomerStart(bot, msg, startParam) {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;

    // 1) customer record
    const customer = await ensureCustomer(msg);

    // 2) startParam: ref_... yoki token
    let topMsg = "";

    const parsed = parseStartParam(startParam);

    // ---- REFERRAL FLOW ----
    if (parsed.kind === "ref") {
        const inviterTgId = parsed.inviterTgId;
        const r = await applyReferral({ inviterTgId, inviteeTgId: tgId });

        if (r.ok) {
            topMsg +=
                `✅ Taklif muvaffaqiyatli qabul qilindi!\n` +
                `👥 Taklif qilgan foydalanuvchining jami takliflari: ${r.count} ta\n` +
                `⭐️ Uning umumiy taklif ballari: ${r.newRefPoints}\n` +
                (r.delta > 0
                    ? `🎉 Taklif qilgan foydalanuvchiga +${r.delta} ball qo‘shildi!\n\n`
                    : `ℹ️ Keyingi ballni olish uchun yana do‘stlar taklif qilish kerak.\n\n`);

            // Taklif qilgan foydalanuvchiga xabar
            try {
                if (r.delta > 0) {
                    await bot.sendMessage(
                        inviterTgId,
                        `🎉 Ajoyib yangilik!\nSizning linkingiz orqali yangi foydalanuvchi qo‘shildi.\n✅ Sizga +${r.delta} ball berildi!`
                    );
                } else {
                    await bot.sendMessage(
                        inviterTgId,
                        `👥 Sizning linkingiz orqali yangi foydalanuvchi qo‘shildi.\n⭐️ Eslatma: har 3 ta do‘st = 1 ball.`
                    );
                }
            } catch { }
        } else {
            if (r.reason === "self_ref")
                topMsg += "⚠️ O‘zingizni o‘zingiz taklif qila olmaysiz.\n\n";
            else if (r.reason === "already_used")
                topMsg += "ℹ️ Siz avval taklif havolasi orqali ro‘yxatdan o‘tgansiz. Takror hisoblanmaydi.\n\n";
            else
                topMsg += "⚠️ Taklif havolasi noto‘g‘ri yoki yaroqsiz.\n\n";
        }
    }

    // ---- QR TOKEN REDEEM FLOW (NEW) ----
    if (parsed.kind === "token") {
        const { redeemReceiptToken } = require("../services/receipt");

        const r = await redeemReceiptToken({ token: parsed.token, tgUser: msg.from });

        if (r.ok) {
            const added = r.tokenDoc?.bonusAdded ?? r.bonusAdded ?? 0; // qaysi formatda qaytarsangiz
            const formatted = Number(added).toLocaleString("uz-UZ");
            topMsg += `✅ QR qabul qilindi. Sizga <b>${formatted} so'm</b> qo‘shildi!\n\n`;
        } else if (r.code === "ALREADY_USED") {
            topMsg += "⚠️ Bu QR allaqachon ishlatilgan.\n\n";
        } else if (r.code === "NOT_FOUND") {
            topMsg += "❌ QR topilmadi yoki noto‘g‘ri.\n\n";
        } else {
            topMsg += "❌ Xatolik. Qayta urinib ko‘ring.\n\n";
        }
    }

    // 3) group check
    const member = await isMember(bot, tgId);
    if (!member) {
        return bot.sendMessage(
            chatId,
            topMsg +
            "🔒 Ballarni ko‘rish uchun avval kanal/guruhga obuna bo‘ling:\n" +
            (GROUP_INVITE_LINK ? GROUP_INVITE_LINK : "Guruh linki sozlanmagan"),
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        GROUP_INVITE_LINK ? [{ text: "➕ Obuna bo‘lish", url: GROUP_INVITE_LINK }] : [],
                        [{ text: "✅ Tekshirish", callback_data: "check_sub" }],
                    ].filter((r) => r.length),
                },
            }
        );
    }

    // 4) webapp button
    // Eslatma: Telegram WebApp auth initData bilan bo‘ladi, shuning uchun urlga token shart emas
    const url = `${WEBAPP_URL}/customer`;

    // customer points yangilangan bo‘lishi mumkin (redeem/referral)
    const fresh = await Customer.findOne({ tgId }).lean();
    const rawPoints = Math.floor(fresh?.points ?? 0);
    const formattedPoints = Number(rawPoints).toLocaleString("uz-UZ");

    return bot.sendMessage(
        chatId,
        topMsg +
        `👤 <b>${fresh?.tgName || customer.tgName}</b>\n` +
        `💰 <b>${formattedPoints} so'm</b>`,
        {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💵 Kashbeklarim", web_app: { url } }]
                ],
            },
        }
    );
}

module.exports = { onCustomerStart };