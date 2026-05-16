// src/handlers/expenseFlow.js
const dayjs = require("dayjs");

const Expense = require("../models/Expense");
const Supplier = require("../models/Supplier");
const Counter = require("../models/Counter");
const { redis } = require("../services/auth");

const { expenseCategoryKeyboard, supplierListKeyboard, mainMenuKeyboard } = require("../keyboards");
const { formatMoney } = require("../utils/money");
const { getUserName, escapeHtml } = require("../logic/ui");
const { nextOrderNo } = require("../services/orderNo");
const { addBalance } = require("../logic/storage");
const { sendToGroup } = require("../services/notify");

const KEY = (userId) => `exp_state:${userId}`;

const NEED_DESC = new Set(["other", "repair", "bank"]);
const REQUIRED_DESCRIPTION_CATEGORIES = new Set(["other", "repair", "bank"]);

const CAT_LABELS = {
    other:       "Proche rasxodlar",
    rent:        "Arenda",
    electricity: "Elektr energiya",
    supplier:    "Firma (Taminotga)",
    cash:        "Kapilka",
    worker:      "Ishchiga",
    food:        "Abetga",
    taxi:        "Taksiga",
    repair:      "Ustaga",
    bank:        "Bank / Soliq to'lovlari",
};

function getCatLabel(key) {
    return CAT_LABELS[key] || key || "Boshqa";
}

async function getBalance() {
    const doc = await Counter.findOne({ key: "balance" }).lean();
    return Number(doc?.value || 0);
}

function expenseGroupText(exp) {
    const who    = exp?.spender?.tgName || "-";
    const catKey = exp?.categoryKey || "other";
    const catUz  = getCatLabel(catKey);
    const title  = String(exp?.title || "").trim();
    const amount = formatMoney(exp?.amount || 0);
    const time   = dayjs(exp.createdAt || new Date()).format("YYYY-MM-DD HH:mm");

    let nima = escapeHtml(catUz);
    if (NEED_DESC.has(catKey) && title) {
        nima = `${escapeHtml(catUz)} | ${escapeHtml(title)}`;
    }

    return (
        `❌ <b>CHIQIM</b>\n\n` +
        `👤 Kim: <b>${escapeHtml(who)}</b>\n` +
        `🧾 Nima: <b>${nima}</b>\n` +
        `💸 Summa: <b>-${amount}</b> so'm\n` +
        `🕒 ${time}`
    );
}

async function saveExpenseSafe({ spender, title, amount, categoryKey, description, supplierId }) {
    const balance = await getBalance();
    if (balance < amount) {
        return {
            ok: false,
            reason:
                `❌ <b>Balans yetarli emas!</b>\n` +
                `🏦 Joriy balans: <b>${formatMoney(balance)}</b> so'm\n` +
                `💰 Kerakli: <b>${formatMoney(amount)}</b> so'm\n\n` +
                `Avval kassaga pul kiriting yoki summani kamaytiring.`
        };
    }

    const expData = {
        orderNo:     await nextOrderNo(null),
        spender,
        title:       title || getCatLabel(categoryKey || "other"),
        amount,
        categoryKey: categoryKey || "other",
        description: description || "",
    };
    if (supplierId) expData.supplierId = supplierId;

    const exp = await Expense.create(expData);
    await addBalance(-amount, null);

    return { ok: true, exp };
}

async function startExpense(bot, chatId, userId) {
    await redis.set(KEY(userId), JSON.stringify({ step: "pick_category" }), "EX", 900);
    const balance = await getBalance();
    await bot.sendMessage(
        chatId,
        `💸 <b>Chiqim</b>\n🏦 Joriy balans: <b>${formatMoney(balance)}</b> so'm\n\nKategoriya tanlang:`,
        { parse_mode: "HTML", reply_markup: expenseCategoryKeyboard() }
    );
}

async function onExpenseCallback(bot, q, seller) {
    try { await bot.answerCallbackQuery(q.id); } catch { }

    const data   = q.data || "";
    const chatId = q.message.chat.id;

    if (data === "exp_cancel") {
        await redis.del(KEY(seller.tgId));
        await bot.sendMessage(chatId, "✅ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        return true;
    }

    if (data.startsWith("exp_cat:")) {
        const cat = data.split(":")[1];

        if (cat === "supplier") {
            await redis.set(
                KEY(seller.tgId),
                JSON.stringify({ step: "pick_supplier", categoryKey: "supplier", createdBy: seller }),
                "EX", 900
            );
            await bot.sendMessage(chatId, "🏭 Qarzdorlik mavjud firmalar:", {
                reply_markup: await supplierListKeyboard({
                    onlyWithDebt:   true,
                    selectCbPrefix: "exp_sup_select",
                    backCb:         "exp_cancel"
                })
            });
            return true;
        }

        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({ step: "amount", categoryKey: cat, createdBy: seller }),
            "EX", 900
        );

        const balance = await getBalance();
        await bot.sendMessage(
            chatId,
            `✍️ Summani yozing (masalan: 50000)\n🏦 Joriy balans: <b>${formatMoney(balance)}</b> so'm`,
            { parse_mode: "HTML" }
        );
        return true;
    }

    if (data.startsWith("exp_sup_select:")) {
        const supId = data.split(":")[1];
        const sup   = await Supplier.findById(supId);
        if (!sup) {
            await bot.sendMessage(chatId, "❌ Firma topilmadi.");
            return true;
        }

        const remain = Number(sup.debt || 0);
        if (remain <= 0) {
            await bot.sendMessage(chatId, "✅ Bu firmada qarz yo'q.");
            return true;
        }

        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({
                step:        "supplier_pay_amount",
                categoryKey: "supplier",
                supplierId:  String(sup._id),
                createdBy:   seller
            }),
            "EX", 900
        );

        const balance = await getBalance();
        await bot.sendMessage(
            chatId,
            `🏭 Firma: <b>${escapeHtml(sup.name)}</b>\n` +
            `💳 Firma qarzi: <b>${formatMoney(remain)}</b> so'm\n` +
            `🏦 Kassa balansi: <b>${formatMoney(balance)}</b> so'm\n` +
            `✍️ Qancha to'laysiz?`,
            { parse_mode: "HTML" }
        );
        return true;
    }

    return false;
}

async function onExpenseMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text   = String(msg.text || "").trim();
    if (!userId || !text) return false;

    const stRaw = await redis.get(KEY(userId));
    if (!stRaw) return false;

    let st = null;
    try { st = JSON.parse(stRaw); } catch { }
    if (!st?.step) {
        await redis.del(KEY(userId));
        return false;
    }

    if (st.step === "amount") {
        const amount = parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
        if (amount <= 0) {
            await bot.sendMessage(chatId, "❌ Summa noto'g'ri. Masalan: 50000");
            return true;
        }

        const balance = await getBalance();
        if (balance < amount) {
            await bot.sendMessage(
                chatId,
                `❌ <b>Balans yetarli emas!</b>\n` +
                `🏦 Joriy balans: <b>${formatMoney(balance)}</b> so'm\n` +
                `💰 Kerakli: <b>${formatMoney(amount)}</b> so'm`,
                { parse_mode: "HTML" }
            );
            return true;
        }

        st.amount = amount;

        if (NEED_DESC.has(st.categoryKey)) {
            st.step = "desc";
            await redis.set(KEY(userId), JSON.stringify(st), "EX", 900);
            await bot.sendMessage(chatId, "📝 Description yozing (majburiy). Masalan: Bodiring / Usta haqqi:");
            return true;
        }

        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };
        const result  = await saveExpenseSafe({
            spender,
            title:       getCatLabel(st.categoryKey),
            amount,
            categoryKey: st.categoryKey,
            description: ""
        });

        if (!result.ok) {
            await bot.sendMessage(chatId, result.reason, { parse_mode: "HTML" });
            return true;
        }

        await sendToGroup(bot, expenseGroupText(result.exp));
        await redis.del(KEY(userId));
        await bot.sendMessage(
            chatId,
            `✅ Chiqim saqlandi.\n🆔 ID: <b>${result.exp.orderNo}</b>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O'chirish (Chiqim)", callback_data: `del_exp:${result.exp._id}` }]
                    ]
                }
            }
        );
        return true;
    }

    if (st.step === "desc") {
        const desc = text.trim();
        if (desc.length < 2) {
            await bot.sendMessage(chatId, "❌ Description juda qisqa. Qayta yozing:");
            return true;
        }

        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };
        const result  = await saveExpenseSafe({
            spender,
            title:       desc,
            amount:      Number(st.amount || 0),
            categoryKey: st.categoryKey,
            description: desc
        });

        if (!result.ok) {
            await bot.sendMessage(chatId, result.reason, { parse_mode: "HTML" });
            return true;
        }

        await sendToGroup(bot, expenseGroupText(result.exp));
        await redis.del(KEY(userId));
        await bot.sendMessage(
            chatId,
            `✅ Chiqim saqlandi.\n🆔 ID: <b>${result.exp.orderNo}</b>`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O'chirish (Chiqim)", callback_data: `del_exp:${result.exp._id}` }]
                    ]
                }
            }
        );
        return true;
    }

    if (st.step === "supplier_pay_amount") {
        const amount = parseInt(text.replace(/[^0-9]/g, ""), 10) || 0;
        if (amount <= 0) {
            await bot.sendMessage(chatId, "❌ Summa noto'g'ri. Masalan: 100000");
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
            await bot.sendMessage(chatId, "✅ Bu firmada qarz yo'q.");
            return true;
        }

        const pay     = Math.min(amount, remain);
        const spender = st.createdBy || { tgId: userId, tgName: getUserName(msg) };

        const result = await saveExpenseSafe({
            spender,
            title:       `Firma to'lovi: ${sup.name}`,
            amount:      pay,
            categoryKey: "supplier",
            supplierId:  sup._id,
            description: ""
        });

        if (!result.ok) {
            await bot.sendMessage(chatId, result.reason, { parse_mode: "HTML" });
            return true;
        }

        sup.debt = Math.max(0, remain - pay);
        await sup.save();

        await sendToGroup(bot, expenseGroupText(result.exp));
        await redis.del(KEY(userId));
        await bot.sendMessage(
            chatId,
            `✅ To'landi: <b>${formatMoney(pay)}</b> so'm\n` +
            `💳 Firmada qolgan qarz: <b>${formatMoney(sup.debt)}</b> so'm`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🗑 O'chirish (Chiqim)", callback_data: `del_exp:${result.exp._id}` }]
                    ]
                }
            }
        );
        return true;
    }

    return false;
}

module.exports = {
    startExpense,
    onExpenseMessage,
    onExpenseCallback,
    REQUIRED_DESCRIPTION_CATEGORIES
};
