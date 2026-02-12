// src/handlers/expenseFlow.js
const dayjs = require("dayjs");

const Expense = require("../models/Expense");
const Supplier = require("../models/Supplier");
const { redis } = require("../services/auth");

const { expenseCategoryKeyboard, supplierListKeyboard, mainMenuKeyboard } = require("../keyboards");
const { formatMoney } = require("../utils/money");
const { getUserName, escapeHtml } = require("../logic/ui");
const { nextOrderNo } = require("../services/orderNo");
const { addBalance } = require("../logic/storage");
const { sendToGroup } = require("../services/notify");

const KEY = (userId) => `exp_state:${userId}`;

// ✅ faqat shu 2 ta kategoriya uchun description talab qilamiz
const NEED_DESC = new Set(["other", "master"]);

const CAT_LABELS_UZ = {
    other: "Proche rasxodlar",
    rent: "Arenda",
    electric: "Elektr energiya",
    supplier: "Firma (Taminotga)",
    cashbox: "Kapilka",
    worker: "Ishchiga",
    lunch: "Abetga",
    taxi: "Taksiga",
    master: "Ustaga",
};

function getCatUz(key) {
    return CAT_LABELS_UZ[key] || key || "Boshqa";
}

function expenseGroupText(exp) {
    const who = exp?.spender?.tgName || "-";
    const catKey = exp?.categoryKey || "other";
    const catUz = getCatUz(catKey);

    const title = (exp?.title || "").trim();
    const amount = exp?.amount ? formatMoney(exp.amount) : "0";
    const time = dayjs(exp.createdAt || new Date()).format("YYYY-MM-DD HH:mm");

    const NEED_DESC = new Set(["other", "master"]); // faqat shu 2 tasida desc ko'rinsin

    let nima = escapeHtml(catUz);
    if (NEED_DESC.has(catKey)) {
        nima = `${escapeHtml(catUz)} | ${escapeHtml(title || "-")}`;
    }

    return (
        `❌ <b>CHIQIM</b>\n\n` +
        `👤 Kim: <b>${escapeHtml(who)}</b>\n` +
        `🧾 Nima: <b>${nima}</b>\n` +
        `💸 Summa: <b>-${amount}</b> so'm\n` +
        `🕒 ${time}`
    );
}



async function startExpense(bot, chatId, userId) {
    await redis.set(KEY(userId), JSON.stringify({ step: "pick_category" }), "EX", 900);
    await bot.sendMessage(chatId, "💸 <b>Chiqim</b>\nKategoriya tanlang:", {
        parse_mode: "HTML",
        reply_markup: expenseCategoryKeyboard()
    });
}

async function onExpenseCallback(bot, q, seller) {
    try { await bot.answerCallbackQuery(q.id); } catch { }

    const data = q.data || "";
    const chatId = q.message.chat.id;

    if (data === "exp_cancel") {
        await redis.del(KEY(seller.tgId));
        await bot.sendMessage(chatId, "✅ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        return true;
    }

    // category select
    if (data.startsWith("exp_cat:")) {
        const cat = data.split(":")[1];

        // ✅ Firma (Taminotga) -> Supplier.debt > 0 bo'lganlar
        if (cat === "supplier") {
            await redis.set(
                KEY(seller.tgId),
                JSON.stringify({ step: "pick_supplier", categoryKey: "supplier", createdBy: seller }),
                "EX",
                900
            );

            await bot.sendMessage(chatId, "🏭 Qarzdorlik mavjud firmalar:", {
                reply_markup: await supplierListKeyboard({
                    onlyWithDebt: true,
                    selectCbPrefix: "exp_sup_select",
                    backCb: "exp_cancel"
                })
            });
            return true;
        }

        // ✅ oddiy category -> amount so'raymiz
        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({ step: "amount", categoryKey: cat, createdBy: seller }),
            "EX",
            900
        );
        await bot.sendMessage(chatId, "✍️ Summani yozing (masalan: 50000):");
        return true;
    }

    // ✅ supplier select
    if (data.startsWith("exp_sup_select:")) {
        const supId = data.split(":")[1];
        const sup = await Supplier.findById(supId);
        if (!sup) {
            await bot.sendMessage(chatId, "❌ Firma topilmadi.");
            return true;
        }

        const remain = Number(sup.debt || 0);
        if (remain <= 0) {
            await bot.sendMessage(chatId, "✅ Bu firmada qarz yo‘q.");
            return true;
        }

        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({
                step: "supplier_pay_amount",
                categoryKey: "supplier",
                supplierId: String(sup._id),
                createdBy: seller
            }),
            "EX",
            900
        );

        await bot.sendMessage(
            chatId,
            `🏭 Firma: <b>${escapeHtml(sup.name)}</b>\n💳 Qarz: <b>${formatMoney(remain)}</b> so'm\n✍️ Qancha to‘laysiz?`,
            { parse_mode: "HTML" }
        );
        return true;
    }

    return false;
}

async function onExpenseMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();
    if (!userId || !text) return false;

    const stRaw = await redis.get(KEY(userId));
    if (!stRaw) return false;

    let st = null;
    try { st = JSON.parse(stRaw); } catch { }
    if (!st?.step) {
        await redis.del(KEY(userId));
        return false;
    }

    // 1) amount
    if (st.step === "amount") {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (amount <= 0) {
            await bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 50000");
            return true;
        }

        st.amount = amount;

        // ✅ faqat other/master bo'lsa desc so'raymiz
        if (NEED_DESC.has(st.categoryKey)) {
            st.step = "desc";
            await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);
            await bot.sendMessage(chatId, "📝 Description yozing (majburiy). Masalan: Bodiring / Usta haqqi:");
            return true;
        }

        // ✅ qolgan kategoriyalar: desc so'ramaymiz, avtomatik "-" bilan saqlaymiz
        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };
        const exp = await Expense.create({
            orderNo: await nextOrderNo(null),
            spender,
            title: "Chiqim",             // default title
            amount: Number(st.amount || 0),
            categoryKey: st.categoryKey || "other",
            description: ""              // default desc
        });

        try { await addBalance(-exp.amount, null); } catch { }

        await sendToGroup(bot, expenseGroupText(exp), { parse_mode: "HTML" });

        await redis.del(KEY(userId));
        await bot.sendMessage(
            chatId,
            `✅ Chiqim saqlandi.\n🆔 ID: <b>${exp.orderNo}</b>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O‘chirish (Chiqim)", callback_data: `del_exp:${exp._id}` }],
                    ]
                }
            }
        );
        return true;
    }

    // 2) desc (faqat other/master)
    if (st.step === "desc") {
        const desc = text.trim();
        if (desc.length < 2) {
            await bot.sendMessage(chatId, "❌ Description juda qisqa. Qayta yozing:");
            return true;
        }

        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };

        const exp = await Expense.create({
            orderNo: await nextOrderNo(null),
            spender,
            title: desc, // ✅ nomi desc bo'ladi
            amount: Number(st.amount || 0),
            categoryKey: st.categoryKey || "other",
            description: desc
        });

        try { await addBalance(-exp.amount, null); } catch { }

        await sendToGroup(bot, expenseGroupText(exp), { parse_mode: "HTML" });

        await redis.del(KEY(userId));
        await bot.sendMessage(
            chatId,
            `✅ Chiqim saqlandi.\n🆔 ID: <b>${exp.orderNo}</b>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O‘chirish (Chiqim)", callback_data: `del_exp:${exp._id}` }],
                    ]
                }
            }
        );
        return true;
    }

    // 3) supplier pay amount -> Supplier.debt kamayadi (desc yo'q)
    if (st.step === "supplier_pay_amount") {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (amount <= 0) {
            await bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 100000");
            return true;
        }

        const sup = await Supplier.findById(st.supplierId);
        if (!sup) {
            await redis.del(KEY(userId));
            await bot.sendMessage(chatId, "❌ Firma topilmadi.");
            return true;
        }

        const remain = Number(sup.debt || 0);
        if (remain <= 0) {
            await redis.del(KEY(userId));
            await bot.sendMessage(chatId, "✅ Bu firmada qarz yo‘q.");
            return true;
        }

        const pay = Math.min(amount, remain);
        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };

        const exp = await Expense.create({
            orderNo: await nextOrderNo(null),
            spender,
            title: `Firma to‘lovi: ${sup.name}`,
            amount: pay,
            categoryKey: "supplier",
            supplierId: sup._id,
            description: ""
        });

        try { await addBalance(-pay, null); } catch { }

        sup.debt = Math.max(0, remain - pay);
        await sup.save();

        await sendToGroup(bot, expenseGroupText(exp), { parse_mode: "HTML" });

        await redis.del(KEY(userId));

        await bot.sendMessage(
            chatId,
            `✅ To‘landi: <b>${formatMoney(pay)}</b> so'm\n💳 Qolgan qarz: <b>${formatMoney(sup.debt)}</b> so'm`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O‘chirish (Chiqim)", callback_data: `del_exp:${exp._id}` }],
                        [{ text: "⬅️ Menyu", callback_data: "exp_cancel" }]
                    ]
                }
            }
        );
        return true;
    }

    return false;
}

module.exports = { startExpense, onExpenseMessage, onExpenseCallback };
