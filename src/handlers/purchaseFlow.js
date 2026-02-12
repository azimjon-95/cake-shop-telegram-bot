// src/handlers/purchaseFlow.js (FINAL)
const Supplier = require("../models/Supplier");
const Purchase = require("../models/Purchase");
const Expense = require("../models/Expense");
const { redis } = require("../services/auth");

const { supplierListKeyboard, purchaseEntryKeyboard, mainMenuKeyboard } = require("../keyboards");
const { formatMoney } = require("../utils/money");
const { getUserName } = require("../logic/ui");
const { nextOrderNo } = require("../services/orderNo");
const { sendToGroup } = require("../services/notify");
const { addBalance } = require("../logic/storage");

const KEY = (userId) => `pur_state:${userId}`;

// HTML escape (xatolar bo‘lmasin)
function escapeHtml(str = "") {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function ack(bot, q) {
    try { await bot.answerCallbackQuery(q.id); } catch { }
}

async function editMsg(bot, q, text, reply_markup) {
    try {
        return await bot.editMessageText(text, {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
            parse_mode: "HTML",
            reply_markup
        });
    } catch (e) {
        // "message is not modified" yoki edit mumkin bo'lmasa — yangi xabar yuboramiz
        return bot.sendMessage(q.message.chat.id, text, { parse_mode: "HTML", reply_markup });
    }
}


// START
async function startPurchase(bot, chatId, userId) {
    await redis.set(KEY(userId), JSON.stringify({ step: "entry" }), "EX", 900);

    await bot.sendMessage(
        chatId,
        "📦 <b>Kirim (Taminot)</b>\nQuyidagidan birini tanlang:",
        { parse_mode: "HTML", reply_markup: purchaseEntryKeyboard() }
    );
}

// CALLBACKS
async function onPurchaseCallback(bot, q, seller) {
    const data = q.data || "";
    const chatId = q.message.chat.id;

    await ack(bot, q);

    // Bekor qilish
    if (data === "pur_cancel") {
        await redis.del(KEY(seller.tgId));
        await bot.sendMessage(chatId, "✅ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        return true;
    }

    // Entry menu qaytish
    if (data === "pur_menu_back") {
        await redis.set(KEY(seller.tgId), JSON.stringify({ step: "entry" }), "EX", 900);
        await editMsg(bot, q, "📦 <b>Kirim (Taminot)</b>\nQuyidagidan birini tanlang:", purchaseEntryKeyboard());
        return true;
    }

    // ➕ Yangi firma qo‘shish
    if (data === "pur_menu_add_supplier") {
        await redis.set(KEY(seller.tgId), JSON.stringify({ step: "add_supplier_name" }), "EX", 900);

        await editMsg(bot, q, "➕ <b>Yangi firma</b>\nFirma nomini yozing:", {
            inline_keyboard: [
                [{ text: "⬅️ Orqaga", callback_data: "pur_menu_back" }],
            ]
        });
        return true;
    }

    // 📦 Maxsulot keldi -> firmalar ro‘yxati
    if (data === "pur_menu_products") {
        await redis.set(KEY(seller.tgId), JSON.stringify({ step: "pick_supplier", createdBy: seller }), "EX", 900);

        await editMsg(
            bot,
            q,
            "📦 <b>Maxsulot keldi</b>\nFirmani tanlang:",
            await supplierListKeyboard({
                onlyWithDebt: false,
                backCb: "pur_menu_back",
                selectCbPrefix: "pur_sup_select" // ✅ SHU
            })
        );
        return true;
    }


    // Firma tanlash
    if (data.startsWith("pur_sup_select:")) {
        const supId = data.split(":")[1];
        const sup = await Supplier.findById(supId);
        if (!sup) {
            await bot.sendMessage(chatId, "❌ Firma topilmadi.");
            return true;
        }

        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({
                step: "desc",
                supplierId: String(sup._id),
                createdBy: { tgId: seller.tgId, tgName: seller.tgName }
            }),
            "EX",
            900
        );

        const info =
            `🎂 <b>${escapeHtml(sup.name)}</b>\n` +
            (sup.phone ? `📞 ${escapeHtml(String(sup.phone))}\n` : "") +
            (sup.description ? `🧾 ${escapeHtml(sup.description)}\n` : "");

        await editMsg(
            bot,
            q,
            info + "\n✍️ <b>Nimalar keldi?</b> (matn yozing)",
            {
                inline_keyboard: [
                    [{ text: "⬅️ Orqaga", callback_data: "pur_menu_products" }],
                ]
            }
        );

        return true;
    }


    return false;
}

// MESSAGE FLOW
async function onPurchaseMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();
    if (!userId || !text) return false;

    const stRaw = await redis.get(KEY(userId));
    if (!stRaw) return false;

    let st;
    try { st = JSON.parse(stRaw); } catch { st = null; }
    if (!st?.step) {
        await redis.del(KEY(userId));
        return false;
    }

    // 1) Yangi firma yaratish: name, phone, description so‘ralsin
    if (st.step === "add_supplier_name") {
        const name = text.trim();
        if (name.length < 2) {
            await bot.sendMessage(chatId, "❌ Firma nomi juda qisqa. Qayta yozing:");
            return true;
        }

        st.newSupplier = { name };
        st.step = "add_supplier_phone";
        await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);

        await bot.sendMessage(chatId, "📞 Telefon raqamini yozing (xohlamasangiz '-' )");
        return true;
    }

    if (st.step === "add_supplier_phone") {
        const phone = text === "-" ? null : text;
        st.newSupplier.phone = phone;
        st.step = "add_supplier_desc";
        await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);

        await bot.sendMessage(chatId, "🧾 Firma nimani yetkazadi? (description) yozing (xohlamasangiz '-' )");
        return true;
    }

    if (st.step === "add_supplier_desc") {
        const description = text === "-" ? "" : text;

        const created = await Supplier.create({
            name: st.newSupplier?.name,
            phone: st.newSupplier?.phone || null,
            description,
            debt: 0
        });

        await redis.set(KEY(userId), JSON.stringify({ step: "entry" }), "EX", 900);

        await bot.sendMessage(
            chatId,
            `✅ Firma qo‘shildi: <b>${escapeHtml(created.name)}</b>\nEndi “📦 Maxsulot keldi” ni bosing.`,
            { parse_mode: "HTML", reply_markup: purchaseEntryKeyboard() }
        );
        return true;
    }

    // 2) Description
    if (st.step === "desc") {
        st.desc = text === "-" ? "" : text;
        st.step = "total";
        await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);

        await bot.sendMessage(chatId, "💰 Jami qancha pulik maxsulot keldi? (masalan: 1000000)");
        return true;
    }

    // 3) totalCost
    if (st.step === "total") {
        const totalCost = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (totalCost <= 0) {
            await bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 1000000");
            return true;
        }

        st.totalCost = totalCost;
        st.step = "paid";
        await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);

        await bot.sendMessage(
            chatId,
            `💰 Jami: <b>${formatMoney(totalCost)}</b> so'm\n✅ Qanchasi to'landi? (0 ham bo‘ladi)`,
            { parse_mode: "HTML" }
        );
        return true;
    }

    // 4) paid -> save Purchase + Supplier.debt + Expense + Counter
    if (st.step === "paid") {
        const paid = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        const totalCost = Number(st.totalCost || 0);

        if (paid < 0 || paid > totalCost) {
            await bot.sendMessage(chatId, `❌ To‘langan summa 0 dan ${formatMoney(totalCost)} gacha bo‘lsin.`);
            return true;
        }

        const supplier = await Supplier.findById(st.supplierId);
        if (!supplier) {
            await redis.del(KEY(userId));
            await bot.sendMessage(chatId, "❌ Firma topilmadi. Qayta urinib ko‘ring.");
            return true;
        }

        const createdBy = st.createdBy || { tgId: userId, tgName: getUserName(msg) };
        const debtAdd = Math.max(0, totalCost - paid);

        // ✅ Purchase create (schema: totalCost, desc, createdBy)
        const purchase = await Purchase.create({
            orderNo: await nextOrderNo(null),
            supplierId: supplier._id,
            totalCost,
            description: st.desc || "",
            createdBy
        });

        // ✅ Agar to‘lov bo‘lsa — Expense yozamiz va Counter minus
        if (paid > 0) {
            await Expense.create({
                orderNo: await nextOrderNo(null),
                spender: createdBy,
                title: `Firma to‘lovi: ${supplier.name}`,
                amount: paid,
                categoryKey: "supplier",
                supplierId: supplier._id,
                description: st.desc || ""
            });

            // Counter balance minus
            try { await addBalance(-paid); } catch { }
        }

        // ✅ Qarzni Supplier.debt ga yig‘amiz
        if (debtAdd > 0) {
            supplier.debt = Number(supplier.debt || 0) + debtAdd;
            await supplier.save();
        }

        await redis.del(KEY(userId));

        await bot.sendMessage(
            chatId,
            `✅ <b>Kirim saqlandi</b>\n` +
            `🎂 Firma: <b>${escapeHtml(supplier.name)}</b>\n` +
            `🧾 Nima keldi: <b>${escapeHtml(st.desc || "-")}</b>\n` +
            `💰 Jami: <b>${formatMoney(totalCost)}</b> so'm\n` +
            `✅ To'landi: <b>${formatMoney(paid)}</b> so'm\n` +
            `💳 Qarz: <b>${formatMoney(debtAdd)}</b> so'm`,
            { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
        );

        // gruppaga ham xabar
        await sendToGroup(
            bot,
            `📦 <b>KIRIM (TAMINOT)</b>\n\n` +
            `🎂 Kimdan: <b>${escapeHtml(supplier.name)}</b>\n` +
            `🧾 ${escapeHtml(st.desc || "-")}\n` +
            `💰 Jami: <b>${formatMoney(totalCost)}</b> so'm\n` +
            `✅ To'landi: <b>${formatMoney(paid)}</b> so'm\n` +
            `💳 Qarz: <b>${formatMoney(debtAdd)}</b> so'm`,
            { parse_mode: "HTML" }
        );

        return true;
    }

    return false;
}

module.exports = { startPurchase, onPurchaseMessage, onPurchaseCallback, editMsg };
