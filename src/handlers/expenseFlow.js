// src/handlers/expenseFlow.js
const dayjs = require("dayjs");

const Expense = require("../models/Expense");
const Supplier = require("../models/Supplier");
const { redis, claimOnce } = require("../services/auth");

const { expenseCategoryKeyboard, supplierListKeyboard, mainMenuKeyboard } = require("../keyboards");
const { formatMoney } = require("../utils/money");
const { getUserName, escapeHtml } = require("../logic/ui");
const { nextOrderNo } = require("../services/orderNo");
const { addBalance, getBalance } = require("../logic/storage");
const { currentBranch } = require("../services/branches");
const { supplierDebtOf, applySupplierDebtDelta } = require("../services/branchData");
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

    const branch = currentBranch();
    const expData = {
        orderNo:     await nextOrderNo(null),
        branchId:    branch,
        spender,
        title:       title || getCatLabel(categoryKey || "other"),
        amount,
        categoryKey: categoryKey || "other",
        description: description || "",
    };
    if (supplierId) expData.supplierId = supplierId;

    const exp = await Expense.create(expData);
    await addBalance(-amount, null, branch);

    return { ok: true, exp };
}

// Firmaga to'lov (matn bilan summa yozilganda ham, ovozdan kelgan summa tasdiqlanganda ham shu yo'l)
async function paySupplierFromState(bot, chatId, userId, st, amount, fallbackName) {
    const sup = await Supplier.findById(st.supplierId);
    if (!sup) {
        await redis.del(KEY(userId));
        await bot.sendMessage(chatId, "❌ Firma topilmadi.");
        return true;
    }

    const remain = supplierDebtOf(sup, currentBranch());
    if (remain <= 0) {
        await redis.del(KEY(userId));
        await bot.sendMessage(chatId, "✅ Bu firmada qarz yo'q.");
        return true;
    }

    const pay     = Math.min(amount, remain);
    const spender = st.createdBy || { tgId: userId, tgName: fallbackName };

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

    applySupplierDebtDelta(sup, currentBranch(), -pay);
    await sup.save();
    const supLeft = supplierDebtOf(sup, currentBranch());

    await sendToGroup(bot, expenseGroupText(result.exp));
    await redis.del(KEY(userId));
    await bot.sendMessage(
        chatId,
        `✅ To'landi: <b>${formatMoney(pay)}</b> so'm\n` +
        `💳 Firmada qolgan qarz: <b>${formatMoney(supLeft)}</b> so'm`,
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

// Ovozdan "firma" chiqimi: mavjud tanlash oqimi (pick_supplier) + ovozdan aytilgan summa saqlanadi
async function startSupplierPickWithAmount(bot, chatId, seller, amount) {
    await redis.set(
        KEY(seller.tgId),
        JSON.stringify({ step: "pick_supplier", categoryKey: "supplier", createdBy: seller, presetAmount: amount }),
        "EX", 900
    );
    await bot.sendMessage(chatId,
        `🏷 <b>Firma (Ta'minot)</b> — ovozdan: <b>${formatMoney(amount)}</b> so'm\n🏭 Qarzdorlik mavjud firmalar:`,
        {
            parse_mode: "HTML",
            reply_markup: await supplierListKeyboard({
                onlyWithDebt:   true,
                selectCbPrefix: "exp_sup_select",
                backCb:         "exp_cancel"
            })
        }
    );
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

        const remain = supplierDebtOf(sup, currentBranch());
        if (remain <= 0) {
            await bot.sendMessage(chatId, "✅ Bu firmada qarz yo'q.");
            return true;
        }

        // Ovozdan kelgan summa bo'lsa — saqlab qo'yamiz (faqat shu foydalanuvchining pick_supplier holatidan)
        let preset = 0;
        try {
            const prev = JSON.parse((await redis.get(KEY(seller.tgId))) || "null");
            if (prev?.step === "pick_supplier" && Number(prev.presetAmount) > 0) preset = Number(prev.presetAmount);
        } catch { }

        await redis.set(
            KEY(seller.tgId),
            JSON.stringify({
                step:        "supplier_pay_amount",
                categoryKey: "supplier",
                supplierId:  String(sup._id),
                createdBy:   seller,
                ...(preset ? { presetAmount: preset } : {})
            }),
            "EX", 900
        );

        const balance = await getBalance();
        await bot.sendMessage(
            chatId,
            `🏭 Firma: <b>${escapeHtml(sup.name)}</b>\n` +
            `💳 Firma qarzi: <b>${formatMoney(remain)}</b> so'm\n` +
            `🏦 Kassa balansi: <b>${formatMoney(balance)}</b> so'm\n` +
            (preset
                ? `🎤 Ovozdan summa: <b>${formatMoney(preset)}</b> so'm — tasdiqlang yoki boshqa summa yozing`
                : `✍️ Qancha to'laysiz?`),
            {
                parse_mode: "HTML",
                ...(preset ? { reply_markup: { inline_keyboard: [[
                    { text: `✅ ${formatMoney(preset)} so'm to'lash`, callback_data: "exp_sup_preset" },
                    { text: "❌ Bekor", callback_data: "exp_cancel" },
                ]] } } : {})
            }
        );
        return true;
    }

    // 🎤 Ovozdan aytilgan summani tasdiqlash (ikki marta bosilsa — bir marta to'lanadi)
    if (data === "exp_sup_preset") {
        const claimed = await claimOnce(`exp_sup_preset:${chatId}:${q.message.message_id}`, 600);
        if (!claimed) return true;
        try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id }); } catch { }

        let st = null;
        try { st = JSON.parse((await redis.get(KEY(seller.tgId))) || "null"); } catch { }
        if (!st || st.step !== "supplier_pay_amount" || !(Number(st.presetAmount) > 0)) {
            await bot.sendMessage(chatId, "⌛ Vaqti o'tgan. Ovozni qayta yuboring.");
            return true;
        }
        return paySupplierFromState(bot, chatId, seller.tgId, st, Number(st.presetAmount), seller.tgName);
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
        await paySupplierFromState(bot, chatId, userId, st, amount, getUserName(msg));
        return true;
    }

    return false;
}

module.exports = {
    startExpense,
    onExpenseMessage,
    onExpenseCallback,
    startSupplierPickWithAmount,
    REQUIRED_DESCRIPTION_CATEGORIES
};
