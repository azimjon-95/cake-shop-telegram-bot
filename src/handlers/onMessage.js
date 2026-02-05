// src/bot/handlers/onMessage.js
const dayjs = require("dayjs");

const cartService = require("../services/cartService");
const { formatCart } = require("../services/cartFormat");
const { listProducts, listCategories } = require("../services/productService");

const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Product = require("../models/Product");
const ProductArchive = require("../models/ProductArchive");
const Counter = require("../models/Counter");

const { mongoose } = require("../db");

const {
    mainMenuKeyboard,
    startKeyboard,
    monthKeyboard,
    categoryKeyboard,
    catalogKeyboard,
} = require("../keyboards");

const {
    isAuthed,
    setAuthed,
    setMode,
    getMode,
    checkPassword,
    redis, // ✅ faqat shu redis
} = require("../services/auth");

const { parseSaleMessage } = require("../utils/parseSale");
const { parseExpenseMessage } = require("../utils/parseExpense");

const { sendToGroup } = require("../services/notify");
const { closeCashAndMakeReport } = require("../services/closeCash");

const {
    saleNotifyText,
    expenseNotifyText,
    closeNotifyText,
} = require("../utils/report");

const {
    startProductAdd,
    handleWizardInput,
    clearDraft,
} = require("../services/productWizard");

const { saveSaleWithTx, saveExpenseWithTx } = require("../helpers/tx");
const { helpText, escapeHtml, getUserName, formatDebtCard } = require("../helpers/text");
const { formatMoney } = require("../utils/money");
const { deleteChannelPostIfOutOfStock } = require("../services/productChannelSync");

// ✅ Cart message doim bitta bo'lsin (edit/upsert)
const { upsertCartMessage } = require("../helpers/cartDock");

/* ================= UI helpers ================= */

function debtPayButton(debtId) {
    return {
        reply_markup: {
            inline_keyboard: [[{ text: "💳 To'lash", callback_data: `pay:${debtId}` }]],
        },
    };
}

function normCatFromBtn(txt) {
    return String(txt || "").replace(/^📁\s*/i, "").trim().toLowerCase();
}

/* ================= CART UI ================= */

function cartKeyboard(items) {
    const rows = [];
    for (const it of items) {
        const pid = String(it.product?._id || it.productId || "");
        rows.push([
            { text: "➖", callback_data: `cart:dec:${pid}` },
            { text: `${it.qty}x`, callback_data: "noop" },
            { text: "➕", callback_data: `cart:inc:${pid}` },
        ]);
    }
    rows.push([{ text: "➕ Davom etish", callback_data: "back_to_cat" }]);
    rows.push([{ text: "✅ Sotish", callback_data: "sell" }]);
    return { inline_keyboard: rows };
}

/* ================= Catalog pagination helper ================= */

async function sendProductsList(bot, chatId, { category = null, page = 1 } = {}) {
    const limit = 10;
    const { items, pages } = await listProducts({ category, page, limit });

    if (!items || !items.length) {
        return bot.sendMessage(
            chatId,
            category ? "📦 Bu kategoriyada mahsulot yo‘q." : "📦 Mahsulotlar yo‘q."
        );
    }

    for (const p of items) {
        const text =
            `🧾 <b>${escapeHtml(p.code || "")}</b>\n` +
            `🍰 <b>${escapeHtml(p.name)}</b>\n` +
            `📁 ${escapeHtml(p.category)}\n` +
            `💰 ${formatMoney(p.salePrice)} so'm\n` +
            `📦 ${p.qty} ta` +
            (p.desc ? `\n📝 ${escapeHtml(p.desc)}` : "");

        const kb = {
            inline_keyboard: [
                [{ text: "🗑 Delete", callback_data: `pdel:${p._id}` }],
                [{ text: "⏳ Muddati o‘tgan", callback_data: `pexp:${p._id}` }],
            ],
        };

        if (p.photo?.tgFileId) {
            await bot.sendPhoto(chatId, p.photo.tgFileId, {
                caption: text,
                parse_mode: "HTML",
                reply_markup: kb,
            });
        } else {
            await bot.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: kb });
        }
    }

    const navRow = [];
    const catKey = category ? String(category).toLowerCase() : "all";
    if (page > 1) navRow.push({ text: "⬅️ Oldingi", callback_data: `plist:${catKey}:${page - 1}` });
    if (page < pages) navRow.push({ text: "➡️ Keyingi", callback_data: `plist:${catKey}:${page + 1}` });

    if (navRow.length) {
        await bot.sendMessage(chatId, "📄 Sahifa:", { reply_markup: { inline_keyboard: [navRow] } });
    }
}

/* ================= Balance helper ================= */

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;

    const created = await Counter.create(
        [{ key: "balance", value: 0 }],
        session ? { session } : undefined
    );
    return created[0];
}

/* ================= Product delete/expired (reason step) ================= */

async function handlePendingProductDelete(bot, msg, userId, chatId, text) {
    const pendingStr = await redis.get(`prod_del_pending:${userId}`);
    if (!pendingStr) return false;

    const reason = String(text || "").trim();
    if (!reason) {
        await bot.sendMessage(chatId, "❌ Sabab bo‘sh bo‘lmasin. Qayta yozing.");
        return true;
    }

    await redis.del(`prod_del_pending:${userId}`);

    let pending;
    try {
        pending = JSON.parse(pendingStr);
    } catch {
        await bot.sendMessage(chatId, "⚠️ Pending ma’lumot buzilgan. Qaytadan urinib ko‘ring.");
        return true;
    }

    const { action, productId } = pending; // action: delete|expired
    const p = await Product.findById(productId);
    if (!p) {
        await bot.sendMessage(chatId, "❌ Mahsulot topilmadi.");
        return true;
    }

    await ProductArchive.create({
        productId: p._id,
        action: action === "expired" ? "expired" : "delete",
        reason,
        deletedBy: { tgId: userId, tgName: getUserName(msg) },
        deletedAt: new Date(),
        snapshot: {
            code: p.code,
            name: p.name,
            category: p.category,
            desc: p.desc,
            qty: p.qty,
            costPrice: p.costPrice,
            salePrice: p.salePrice,
            oldPrice: p.oldPrice ?? null,
            photo: { tgFileId: p.photo?.tgFileId ?? null, url: p.photo?.url ?? null },
            createdBy: { tgId: p.createdBy?.tgId ?? null, tgName: p.createdBy?.tgName ?? "" },
            stats: { soldQty: p.stats?.soldQty ?? 0, revenue: p.stats?.revenue ?? 0 },
            isActive: p.isActive,
            isDeleted: p.isDeleted,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
        },
    });

    await Product.deleteOne({ _id: p._id });

    await bot.sendMessage(
        chatId,
        `✅ O‘chirildi: <b>${escapeHtml(p.name)}</b>\n` +
        `📌 Turi: <b>${action === "expired" ? "Muddati o‘tgan" : "Delete"}</b>\n` +
        `✍️ Sabab: <b>${escapeHtml(reason)}</b>`,
        { parse_mode: "HTML" }
    );

    return true;
}

/* ================= Main handler ================= */

async function onMessage(bot, msg, { CHANNEL_ID }) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    if (!userId) return;

    // 0) Pin/unpin service xabarlar (tozalab yuborish)
    if (msg.pinned_message) {
        try { await bot.deleteMessage(chatId, msg.message_id); } catch { }
        return;
    }
    if (typeof msg.text === "string") {
        const t = msg.text.toLowerCase();
        if (
            t.includes("закрепил") ||
            t.includes("закреплено") ||
            t.includes("открепил") ||
            t.includes("удалённое сообщение")
        ) {
            try { await bot.deleteMessage(chatId, msg.message_id); } catch { }
            return;
        }
    }

    // text bo‘lmasa ham wizard ishlashi kerak (photo ham)
    const text = typeof msg.text === "string" ? msg.text.trim() : "";

    // 1) Agar komanda bo‘lsa, narx kutish state’ini tozalaymiz (spam bo‘lmasin)
    if (text && /^\/\w+/.test(text)) {
        cartService.clearState(chatId);
    }

    /* =========================================================
     * CART PRICE CHANGE:
     * - faqat savat xabariga REPLY qilib raqam yozsa ishlaydi
     * - raqam bo‘lmasa: jim (error spam yo‘q)
     * ========================================================= */
    if (text) {
        const st = cartService.getState(chatId);
        if (st?.mode === "await_last_price") {
            const savedCartMsgId = await redis.get(`cart_msg:${chatId}`);
            const repliedId = msg?.reply_to_message?.message_id;

            const isReplyToCart =
                savedCartMsgId && repliedId && Number(savedCartMsgId) === Number(repliedId);

            if (isReplyToCart) {
                const num = parseInt(text.replace(/[^\d]/g, ""), 10);
                if (num > 0) {
                    cartService.setLastSoldPrice(chatId, num);

                    const items = cartService.listItems(chatId);
                    const totals = cartService.calcTotals(chatId);

                    // ✅ Savatni edit/upsert qilamiz (bitta xabar)
                    await upsertCartMessage(
                        bot,
                        redis,
                        chatId,
                        formatCart(items, totals),
                        cartKeyboard(items)
                    );

                    // user yuborgan narx xabarini ham o‘chirib qo‘ysak chiroyli (ixtiyoriy)
                    try { await bot.deleteMessage(chatId, msg.message_id); } catch { }

                    return;
                }

                // raqam emas -> jim qaytamiz (spam yo‘q)
                return;
            }
        }
    }

    /* ================= 2) AVVAL wizard (photo ham) ================= */
    const handledWizard = await handleWizardInput({
        bot,
        redis,
        msg,
        userId,
        chatId,
        channelId: CHANNEL_ID,
        getUserName,
    });
    if (handledWizard) return;

    /* ================= 3) pending product delete/expired reason ================= */
    if (text) {
        const handledPending = await handlePendingProductDelete(bot, msg, userId, chatId, text);
        if (handledPending) return;
    }

    // wizard ham emas, pending ham emas, text yo‘q bo‘lsa chiqamiz
    if (!text) return;

    /* ================= /start + auth ================= */
    if (/^\/start/i.test(text)) {
        const ok = await isAuthed(userId);
        if (ok) {
            await setMode(userId, "menu");
            return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
        }
        await setMode(userId, "await_password");
        return bot.sendMessage(chatId, "🔑 Parolni kiriting:");
    }

    const mode = await getMode(userId);

    if (mode === "await_password") {
        if (checkPassword(text)) {
            await setAuthed(userId);
            await setMode(userId, "menu");
            return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
        }
        return bot.sendMessage(chatId, "❌ Noto‘g‘ri parol. Qayta kiriting:");
    }

    const ok = await isAuthed(userId);
    if (!ok) {
        return bot.sendMessage(chatId, "🔒 Avval /start bosing va parol kiriting.", startKeyboard());
    }

    /* ================= debt partial pay awaiting ================= */
    const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
    if (awaitingDebtId) {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (!amount) return bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 30000");
        // bu joy sizda payDebt flow bilan to‘ldiriladi
        return;
    }

    /* ================= DELETE MODE (sale/expense delete) ================= */
    const delMode = await redis.get(`del_mode:${userId}`);

    const normalizeOrder = (input) => {
        const raw = String(input || "").replace(/[^\d]/g, "");
        if (!raw) return null;
        const num = String(parseInt(raw, 10));
        const pad4 = raw.padStart(4, "0");
        return Array.from(new Set([raw, num, pad4].filter(Boolean)));
    };

    const safeSendToGroup = async (bot2, textToSend) => {
        try {
            await sendToGroup(bot2, textToSend);
        } catch (e) {
            console.log("❌ sendToGroup error:", e?.response?.body || e?.message || e);
        }
    };

    if (delMode === "await_order") {
        const orders = normalizeOrder(text);
        if (!orders) return bot.sendMessage(chatId, "❌ Tartib raqam noto‘g‘ri. Masalan: #0009");

        await redis.set(`del_order:${userId}`, JSON.stringify(orders), "EX", 300);
        await redis.set(`del_mode:${userId}`, "await_reason", "EX", 300);

        return bot.sendMessage(
            chatId,
            `✍️ Nima uchun <b>#${orders[0]}</b> ni o‘chiryapsiz? (Sabab yozing)`,
            { parse_mode: "HTML" }
        );
    }

    if (delMode === "await_reason") {
        const reason = text.trim();

        await redis.del(`del_mode:${userId}`);
        const ordersJson = await redis.get(`del_order:${userId}`);
        await redis.del(`del_order:${userId}`);

        if (!ordersJson) return bot.sendMessage(chatId, "❌ Tartib raqam topilmadi. Qayta urinib ko‘ring.");

        const orders = (() => {
            try { return JSON.parse(ordersJson); } catch { return null; }
        })();

        if (!Array.isArray(orders) || orders.length === 0) {
            return bot.sendMessage(chatId, "❌ Tartib raqam noto‘g‘ri saqlandi. Qayta urinib ko‘ring.");
        }

        const actor = { tgId: userId, tgName: getUserName(msg) };

        let sale = await Sale.findOne({ orderNo: { $in: orders } });
        let exp = null;
        if (!sale) exp = await Expense.findOne({ orderNo: { $in: orders } });

        if (!sale && !exp) {
            exp = await Expense.findOne({ "spender.tgId": userId }).sort({ createdAt: -1 });
            if (!exp) return bot.sendMessage(chatId, `❌ <b>#${orders[0]}</b> topilmadi.`, { parse_mode: "HTML" });

            await bot.sendMessage(
                chatId,
                `⚠️ <b>#${orders[0]}</b> bo‘yicha topilmadi.\nOxirgi CHIQIM topildi va o‘chiriladi:\n<b>${escapeHtml(exp.title)}</b> — <b>${formatMoney(exp.amount)}</b> so'm`,
                { parse_mode: "HTML" }
            );
        }

        const session = await mongoose.startSession();

        let deletedType = "";
        let deletedOrderNo = "";
        let deletedAmount = 0;

        try {
            await session.withTransaction(async () => {
                const bal = await ensureBalance(session);

                if (sale) {
                    deletedType = "SOTUV";
                    deletedOrderNo = sale.orderNo || orders[0];
                    deletedAmount = sale.paidTotal || 0;

                    bal.value -= deletedAmount;
                    await bal.save({ session });

                    await Debt.deleteMany({ saleId: sale._id }).session(session);
                    await Sale.deleteOne({ _id: sale._id }).session(session);
                } else if (exp) {
                    deletedType = "CHIQIM";
                    deletedOrderNo = exp.orderNo || orders[0] || "NO_ORDER";
                    deletedAmount = exp.amount || 0;

                    bal.value += deletedAmount;
                    await bal.save({ session });

                    await Expense.deleteOne({ _id: exp._id }).session(session);
                }
            });
        } catch (e) {
            try { session.endSession(); } catch { }
            return bot.sendMessage(chatId, `⚠️ O‘chirishda xatolik: ${e.message}`);
        } finally {
            try { session.endSession(); } catch { }
        }

        await bot.sendMessage(
            chatId,
            `✅ O‘chirildi: <b>${deletedType}</b> #${deletedOrderNo}\n💰 Summa: <b>${formatMoney(deletedAmount)}</b> so'm`,
            { parse_mode: "HTML" }
        );

        const groupText =
            `🗑 <b>O‘CHIRILDI</b>\n` +
            `👤 Kim: <b>${escapeHtml(actor.tgName)}</b>\n` +
            `🧾 Tartib: <b>#${escapeHtml(deletedOrderNo)}</b>\n` +
            `📌 Turi: <b>${deletedType}</b>\n` +
            `💰 Summa: <b>${formatMoney(deletedAmount)}</b> so'm\n` +
            `✍️ Sabab: <b>${escapeHtml(reason)}</b>`;

        await safeSendToGroup(bot, groupText);
        return;
    }

    /* ================= MENU buttons ================= */

    if (text === "🧁 Sotish") {
        await setMode(userId, "sale");
        return bot.sendMessage(
            chatId,
            "🧁 Sotish rejimi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000\nYoki: Tort 100000 80000 tel 903456677"
        );
    }

    if (text === "💸 Chiqim") {
        await setMode(userId, "expense");
        return bot.sendMessage(chatId, "💸 Chiqim rejimi.\nMisol: Svetga 100000\nYoki: Arenda 1000000");
    }

    if (text === "📌 Qarzlar") {
        const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(50);
        if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo‘q.");

        await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
        for (const d of debts) {
            await bot.sendMessage(chatId, formatDebtCard(d), { parse_mode: "HTML", ...debtPayButton(d._id) });
        }
        return;
    }

    if (text === "📆 Oylik hisobot") {
        const year = dayjs().year();
        return bot.sendMessage(chatId, `📆 Oylik hisobot.\nOyni tanlang (${year}):`, {
            reply_markup: monthKeyboard(year),
        });
    }

    if (text === "🔒 Kasani yopish") {
        const summary = await closeCashAndMakeReport();
        const msgText = closeNotifyText(summary);

        await bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
        await sendToGroup(bot, msgText);

        await bot.sendDocument(chatId, summary.filePath, {}, { filename: summary.fileName });
        return;
    }

    if (text === "ℹ️ Yordam") {
        return bot.sendMessage(chatId, helpText(), { parse_mode: "HTML" });
    }

    /* ================= Catalog ================= */

    if (text === "🧁 Katalog" || text === "Katalog" || text.includes("Katalog")) {
        await setMode(userId, "catalog");
        return bot.sendMessage(chatId, "🧁 Katalog menyu:", { reply_markup: catalogKeyboard() });
    }

    if (text === "📦 Mahsulotlar") {
        await setMode(userId, "catalog");
        await sendProductsList(bot, chatId, { category: null, page: 1 });
        return;
    }

    if (text === "📂 Kategoriya bo‘yicha") {
        await setMode(userId, "catalog");

        const cats = await listCategories();
        if (!cats.length) return bot.sendMessage(chatId, "📂 Kategoriyalar yo‘q.");

        const uniq = Array.from(new Set(cats.map((c) => String(c).trim()).filter(Boolean)));

        const kb = uniq.map((c) => [{ text: `📁 ${c}` }]);
        kb.push([{ text: "⬅️ Menyu" }]);

        return bot.sendMessage(chatId, "📂 Kategoriyani tanlang:", {
            reply_markup: { keyboard: kb, resize_keyboard: true, one_time_keyboard: true },
        });
    }

    if (text.startsWith("📁 ")) {
        await setMode(userId, "catalog");
        const cat = normCatFromBtn(text);
        await sendProductsList(bot, chatId, { category: cat, page: 1 });
        return;
    }

    if (text === "➕ Mahsulot qo‘shish") {
        await setMode(userId, "product_add");
        await startProductAdd(redis, userId);
        return bot.sendMessage(chatId, "➕ Mahsulot qo‘shish.\n🍰 Mahsulot nomini yozing (masalan: Napoleon)");
    }

    if (text === "⬅️ Menyu") {
        await setMode(userId, "menu");
        return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
    }

    if (text === "❌ Bekor") {
        await clearDraft(redis, userId);
        await setMode(userId, "menu");
        return bot.sendMessage(chatId, "✅ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
    }

    /* ================= DEFAULT: expense/sale ================= */

    const currentMode = mode === "menu" || !mode ? null : mode;
    const seller = { tgId: userId, tgName: getUserName(msg) };
    const hasMoney = /\d/.test(text);

    if (currentMode === "expense") {
        const exp = parseExpenseMessage(text);
        if (!exp) return bot.sendMessage(chatId, "❌ Chiqim topilmadi. Misol: Svetga 100000");

        const saved = await saveExpenseWithTx({ spender: seller, title: exp.title, amount: exp.amount });

        const notify = expenseNotifyText({
            spenderName: seller.tgName,
            title: saved.title,
            amount: saved.amount,
        });

        await bot.sendMessage(
            chatId,
            `✅ Chiqim saqlandi: -${formatMoney(saved.amount)} so'm\n🧾 Tartib: <code>#${saved.orderNo}</code>`,
            {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish", callback_data: "del:start" }]] },
            }
        );

        await sendToGroup(bot, notify);
        return;
    }

    if (currentMode === "sale" || hasMoney) {
        const parsed = parseSaleMessage(text);
        if (!parsed.items.length) {
            return bot.sendMessage(chatId, "❌ Sotuv topilmadi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000");
        }

        const { sale, debtDoc } = await saveSaleWithTx({
            seller,
            items: parsed.items,
            phone: parsed.phone,
        });

        for (const item of sale.items) {
            await deleteChannelPostIfOutOfStock(bot, item.productId);
        }

        const notify = saleNotifyText({
            sellerName: seller.tgName,
            itemsText: (sale.items || [])
                .map((i) => `${i.name} x${i.qty} (${formatMoney(i.price)})`)
                .join(", "),
            paidTotal: sale.paidTotal,
            debtTotal: sale.debtTotal,
            phone: sale.phone,
        });

        await bot.sendMessage(
            chatId,
            `✅ Sotuv saqlandi.\nTushgan: ${formatMoney(sale.paidTotal)} so'm\n🧾 Tartib N: <code>#${sale.orderNo}</code>` +
            (sale.debtTotal > 0 ? `\nQarz: ${formatMoney(sale.debtTotal)} so'm` : ""),
            {
                parse_mode: "HTML",
                reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish", callback_data: "del:start" }]] },
            }
        );

        await sendToGroup(bot, notify);

        if (debtDoc) {
            await bot.sendMessage(
                chatId,
                `📌 Qarz yaratildi: <b>${formatMoney(debtDoc.remainingDebt)}</b> so'm`,
                { parse_mode: "HTML" }
            );
        }

        return;
    }

    return bot.sendMessage(
        chatId,
        "ℹ️ Menyu tugmalaridan birini tanlang yoki Yordam’ni bosing.",
        { reply_markup: mainMenuKeyboard() }
    );
}

module.exports = { onMessage };










// // src/bot/handlers/onMessage.js
// const dayjs = require("dayjs");
// const { formatCart } = require("../services/cartFormat");
// const { listProducts, listCategories } = require("../services/productService");
// const cartService = require("../services/cartService");
// const { redis } = require("../services/auth");
// const { deleteChannelPostIfOutOfStock } = require("../services/productChannelSync");
// const Sale = require("../models/Sale");
// const Expense = require("../models/Expense");
// const Debt = require("../models/Debt");
// const Product = require("../models/Product");
// const ProductArchive = require("../models/ProductArchive");
// const Counter = require("../models/Counter");

// const { mongoose } = require("../db");

// const {
//     mainMenuKeyboard,
//     startKeyboard,
//     monthKeyboard,
//     categoryKeyboard,
//     catalogKeyboard,
// } = require("../keyboards");

// const {
//     isAuthed,
//     setAuthed,
//     setMode,
//     getMode,
//     checkPassword,
//     redis,
// } = require("../services/auth");

// const { parseSaleMessage } = require("../utils/parseSale");
// const { parseExpenseMessage } = require("../utils/parseExpense");

// const { sendToGroup } = require("../services/notify");
// const { closeCashAndMakeReport } = require("../services/closeCash");

// const {
//     saleNotifyText,
//     expenseNotifyText,
//     closeNotifyText,
// } = require("../utils/report");

// const {
//     startProductAdd,
//     handleWizardInput,
//     clearDraft,
// } = require("../services/productWizard");

// const { saveSaleWithTx, saveExpenseWithTx } = require("../helpers/tx");
// const { helpText, escapeHtml, getUserName, formatDebtCard } = require("../helpers/text");
// const { formatMoney } = require("../utils/money");

// /* ================= UI helpers ================= */

// function debtPayButton(debtId) {
//     return {
//         reply_markup: {
//             inline_keyboard: [[{ text: "💳 To'lash", callback_data: `pay:${debtId}` }]],
//         },
//     };
// }

// function productCard(p) {
//     const code = `🧾 <b>${escapeHtml(p.code)}</b>`;
//     const title = `🍰 <b>${escapeHtml(p.name)}</b>`;
//     const cat = `📁 ${escapeHtml(p.category)}`;
//     const price = `💰 ${formatMoney(p.salePrice)} so'm`;
//     const qty = `📦 ${p.qty} ta`;
//     const desc = p.desc ? `📝 ${escapeHtml(p.desc)}` : "";

//     return [code, title, cat, price, qty, desc].filter(Boolean).join("\n");
// }

// function normCatFromBtn(txt) {
//     // "📁 Tortlar" => "tortlar"
//     return String(txt || "").replace(/^📁\s*/i, "").trim().toLowerCase();
// }

// async function sendProductsList(bot, chatId, { category = null, page = 1 } = {}) {
//     const limit = 10;
//     const { items, pages } = await listProducts({ category, page, limit });

//     if (!items || !items.length) {
//         return bot.sendMessage(
//             chatId,
//             category ? "📦 Bu kategoriyada mahsulot yo‘q." : "📦 Mahsulotlar yo‘q."
//         );
//     }

//     for (const p of items) {
//         const kb = {
//             inline_keyboard: [
//                 [{ text: "🗑 Delete", callback_data: `pdel:${p._id}` }],
//                 [{ text: "⏳ Muddati o‘tgan", callback_data: `pexp:${p._id}` }],
//             ],
//         };

//         if (p.photo?.tgFileId) {
//             await bot.sendPhoto(chatId, p.photo.tgFileId, {
//                 caption: productCard(p),
//                 parse_mode: "HTML",
//                 reply_markup: kb,
//             });
//         } else {
//             await bot.sendMessage(chatId, productCard(p), {
//                 parse_mode: "HTML",
//                 reply_markup: kb,
//             });
//         }
//     }

//     // pagination (inline)
//     const navRow = [];
//     const catKey = category ? String(category).toLowerCase() : "all";

//     if (page > 1) navRow.push({ text: "⬅️ Oldingi", callback_data: `plist:${catKey}:${page - 1}` });
//     if (page < pages) navRow.push({ text: "➡️ Keyingi", callback_data: `plist:${catKey}:${page + 1}` });

//     if (navRow.length) {
//         await bot.sendMessage(chatId, "📄 Sahifa:", {
//             reply_markup: { inline_keyboard: [navRow] },
//         });
//     }
// }

// /* ================= Balance helper ================= */

// async function ensureBalance(session) {
//     const doc = await Counter.findOne({ key: "balance" }).session(session || null);
//     if (doc) return doc;

//     const created = await Counter.create(
//         [{ key: "balance", value: 0 }],
//         session ? { session } : undefined
//     );
//     return created[0];
// }

// /* ================= Product delete/expired (reason step) ================= */

// async function handlePendingProductDelete(bot, msg, userId, chatId, text) {
//     const pendingStr = await redis.get(`prod_del_pending:${userId}`);
//     if (!pendingStr) return false;

//     const reason = String(text || "").trim();
//     if (!reason) {
//         await bot.sendMessage(chatId, "❌ Sabab bo‘sh bo‘lmasin. Qayta yozing.");
//         return true;
//     }

//     await redis.del(`prod_del_pending:${userId}`);

//     let pending;
//     try {
//         pending = JSON.parse(pendingStr);
//     } catch {
//         await bot.sendMessage(chatId, "⚠️ Pending ma’lumot buzilgan. Qaytadan urinib ko‘ring.");
//         return true;
//     }

//     const { action, productId } = pending; // action: delete | expired

//     const p = await Product.findById(productId);
//     if (!p) {
//         await bot.sendMessage(chatId, "❌ Mahsulot topilmadi.");
//         return true;
//     }

//     // arxivga snapshot
//     await ProductArchive.create({
//         productId: p._id,
//         action: action === "expired" ? "expired" : "delete",
//         reason,
//         deletedBy: { tgId: userId, tgName: getUserName(msg) },
//         deletedAt: new Date(),
//         snapshot: {
//             code: p.code,
//             name: p.name,
//             category: p.category,
//             desc: p.desc,
//             qty: p.qty,
//             costPrice: p.costPrice,
//             salePrice: p.salePrice,
//             oldPrice: p.oldPrice ?? null,
//             photo: {
//                 tgFileId: p.photo?.tgFileId ?? null,
//                 url: p.photo?.url ?? null,
//             },
//             createdBy: {
//                 tgId: p.createdBy?.tgId ?? null,
//                 tgName: p.createdBy?.tgName ?? "",
//             },
//             stats: {
//                 soldQty: p.stats?.soldQty ?? 0,
//                 revenue: p.stats?.revenue ?? 0,
//             },
//             isActive: p.isActive,
//             isDeleted: p.isDeleted,
//             createdAt: p.createdAt,
//             updatedAt: p.updatedAt,
//         },
//     });

//     // o‘chiramiz (hard delete)
//     await Product.deleteOne({ _id: p._id });

//     await bot.sendMessage(
//         chatId,
//         `✅ O‘chirildi: <b>${escapeHtml(p.name)}</b>\n` +
//         `📌 Turi: <b>${action === "expired" ? "Muddati o‘tgan" : "Delete"}</b>\n` +
//         `✍️ Sabab: <b>${escapeHtml(reason)}</b>`,
//         { parse_mode: "HTML" }
//     );

//     await setMode(userId, "catalog");
//     await bot.sendMessage(chatId, "🧁 Katalog menyu:", { reply_markup: catalogKeyboard() });

//     return true;
// }

// /* ================= Main handler ================= */

// async function onMessage(bot, msg, { CHANNEL_ID }) {
//     const chatId = msg.chat.id;
//     const userId = msg.from?.id;
//     if (!userId) return;

//     // text bo‘lmasa ham ishlashi kerak (photo msg)
//     const text = typeof msg.text === "string" ? msg.text.trim() : "";

//     // 1) AVVAL wizard (photo ham)
//     const handledWizard = await handleWizardInput({
//         bot,
//         redis,
//         msg,
//         userId,
//         chatId,
//         channelId: CHANNEL_ID,
//         getUserName,
//     });
//     if (handledWizard) return;

//     // 2) pending product delete/expired reason
//     if (text) {
//         const handledPending = await handlePendingProductDelete(bot, msg, userId, chatId, text);
//         if (handledPending) return;
//     }

//     // wizard ham emas, pending ham emas, text yo‘q bo‘lsa chiqamiz
//     if (!text) return;

//     // /start
//     if (/^\/start/i.test(text)) {
//         const ok = await isAuthed(userId);
//         if (ok) {
//             await setMode(userId, "menu");
//             return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
//         }
//         await setMode(userId, "await_password");
//         return bot.sendMessage(chatId, "🔑 Parolni kiriting:");
//     }

//     const mode = await getMode(userId);

//     // password mode
//     if (mode === "await_password") {
//         if (checkPassword(text)) {
//             await setAuthed(userId);
//             await setMode(userId, "menu");
//             return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
//         }
//         return bot.sendMessage(chatId, "❌ Noto‘g‘ri parol. Qayta kiriting:");
//     }

//     // auth check
//     const ok = await isAuthed(userId);
//     if (!ok) {
//         return bot.sendMessage(chatId, "🔒 Avval /start bosing va parol kiriting.", startKeyboard());
//     }

//     // debt partial pay awaiting (sizdagi blok qoladi)
//     const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
//     if (awaitingDebtId) {
//         const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
//         if (!amount) return bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 30000");
//         return;
//     }

//     /* ================= DELETE MODE (sale/expense delete) ================= */
//     const delMode = await redis.get(`del_mode:${userId}`);

//     const normalizeOrder = (input) => {
//         const raw = String(input || "").replace(/[^\d]/g, "");
//         if (!raw) return null;
//         const num = String(parseInt(raw, 10));
//         const pad4 = raw.padStart(4, "0");
//         return Array.from(new Set([raw, num, pad4].filter(Boolean)));
//     };

//     const safeSendToGroup = async (bot, textToSend) => {
//         try {
//             await sendToGroup(bot, textToSend);
//         } catch (e) {
//             console.log("❌ sendToGroup error:", e?.response?.body || e?.message || e);
//         }
//     };

//     if (delMode === "await_order") {
//         const orders = normalizeOrder(text);
//         if (!orders) return bot.sendMessage(chatId, "❌ Tartib raqam noto‘g‘ri. Masalan: #0009");

//         await redis.set(`del_order:${userId}`, JSON.stringify(orders), "EX", 300);
//         await redis.set(`del_mode:${userId}`, "await_reason", "EX", 300);

//         return bot.sendMessage(
//             chatId,
//             `✍️ Nima uchun <b>#${orders[0]}</b> ni o‘chiryapsiz? (Sabab yozing)`,
//             { parse_mode: "HTML" }
//         );
//     }

//     if (delMode === "await_reason") {
//         const reason = text.trim();

//         await redis.del(`del_mode:${userId}`);
//         const ordersJson = await redis.get(`del_order:${userId}`);
//         await redis.del(`del_order:${userId}`);

//         if (!ordersJson) return bot.sendMessage(chatId, "❌ Tartib raqam topilmadi. Qayta urinib ko‘ring.");

//         const orders = (() => {
//             try { return JSON.parse(ordersJson); } catch { return null; }
//         })();

//         if (!Array.isArray(orders) || orders.length === 0) {
//             return bot.sendMessage(chatId, "❌ Tartib raqam noto‘g‘ri saqlandi. Qayta urinib ko‘ring.");
//         }

//         const actor = { tgId: userId, tgName: getUserName(msg) };

//         let sale = await Sale.findOne({ orderNo: { $in: orders } });
//         let exp = null;
//         if (!sale) exp = await Expense.findOne({ orderNo: { $in: orders } });

//         if (!sale && !exp) {
//             exp = await Expense.findOne({ "spender.tgId": userId }).sort({ createdAt: -1 });
//             if (!exp) return bot.sendMessage(chatId, `❌ <b>#${orders[0]}</b> topilmadi.`, { parse_mode: "HTML" });

//             await bot.sendMessage(
//                 chatId,
//                 `⚠️ <b>#${orders[0]}</b> bo‘yicha topilmadi.\nOxirgi CHIQIM topildi va o‘chiriladi:\n<b>${escapeHtml(exp.title)}</b> — <b>${formatMoney(exp.amount)}</b> so'm`,
//                 { parse_mode: "HTML" }
//             );
//         }

//         const session = await mongoose.startSession();

//         let deletedType = "";
//         let deletedOrderNo = "";
//         let deletedAmount = 0;

//         try {
//             await session.withTransaction(async () => {
//                 const bal = await ensureBalance(session);

//                 if (sale) {
//                     deletedType = "SOTUV";
//                     deletedOrderNo = sale.orderNo || orders[0];
//                     deletedAmount = sale.paidTotal || 0;

//                     bal.value -= deletedAmount;
//                     await bal.save({ session });

//                     await Debt.deleteMany({ saleId: sale._id }).session(session);
//                     await Sale.deleteOne({ _id: sale._id }).session(session);
//                 } else if (exp) {
//                     deletedType = "CHIQIM";
//                     deletedOrderNo = exp.orderNo || orders[0] || "NO_ORDER";
//                     deletedAmount = exp.amount || 0;

//                     bal.value += deletedAmount;
//                     await bal.save({ session });

//                     await Expense.deleteOne({ _id: exp._id }).session(session);
//                 }
//             });
//         } catch (e) {
//             try { session.endSession(); } catch { }
//             return bot.sendMessage(chatId, `⚠️ O‘chirishda xatolik: ${e.message}`);
//         } finally {
//             try { session.endSession(); } catch { }
//         }

//         await bot.sendMessage(
//             chatId,
//             `✅ O‘chirildi: <b>${deletedType}</b> #${deletedOrderNo}\n💰 Summa: <b>${formatMoney(deletedAmount)}</b> so'm`,
//             { parse_mode: "HTML" }
//         );

//         const groupText =
//             `🗑 <b>O‘CHIRILDI</b>\n` +
//             `👤 Kim: <b>${escapeHtml(actor.tgName)}</b>\n` +
//             `🧾 Tartib: <b>#${escapeHtml(deletedOrderNo)}</b>\n` +
//             `📌 Turi: <b>${deletedType}</b>\n` +
//             `💰 Summa: <b>${formatMoney(deletedAmount)}</b> so'm\n` +
//             `✍️ Sabab: <b>${escapeHtml(reason)}</b>`;

//         await safeSendToGroup(bot, groupText);
//         return;
//     }

//     /* ================= MENU buttons ================= */

//     if (text === "🧁 Sotish") {
//         await setMode(userId, "sale");
//         return bot.sendMessage(chatId, "🧁 Sotish rejimi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000\nYoki: Tort 100000 80000 tel 903456677");
//     }

//     if (text === "💸 Chiqim") {
//         await setMode(userId, "expense");
//         return bot.sendMessage(chatId, "💸 Chiqim rejimi.\nMisol: Svetga 100000\nYoki: Arenda 1000000");
//     }

//     if (text === "📌 Qarzlar") {
//         const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(50);
//         if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo‘q.");

//         await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
//         for (const d of debts) {
//             await bot.sendMessage(chatId, formatDebtCard(d), { parse_mode: "HTML", ...debtPayButton(d._id) });
//         }
//         return;
//     }

//     if (text === "📆 Oylik hisobot") {
//         const year = dayjs().year();
//         return bot.sendMessage(chatId, `📆 Oylik hisobot.\nOyni tanlang (${year}):`, { reply_markup: monthKeyboard(year) });
//     }

//     if (text === "Mahsulotlar") {
//         return bot.sendMessage(
//             chatId,
//             "📂 Kategoriya tanlang:",
//             { reply_markup: categoryKeyboard() }
//         );
//     }

//     if (text === "🔒 Kasani yopish") {
//         const summary = await closeCashAndMakeReport();

//         const msgText = closeNotifyText(summary);
//         await bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
//         await sendToGroup(bot, msgText);

//         await bot.sendDocument(chatId, summary.filePath, {}, { filename: summary.fileName });
//         return;
//     }

//     if (text === "ℹ️ Yordam") {
//         return bot.sendMessage(chatId, helpText(), { parse_mode: "HTML" });
//     }

//     /* ================= Catalog ================= */

//     if (text === "🧁 Katalog" || text === "Katalog" || text.includes("Katalog")) {
//         await setMode(userId, "catalog");
//         return bot.sendMessage(chatId, "🧁 Katalog menyu:", { reply_markup: catalogKeyboard() });
//     }

//     if (text === "📦 Mahsulotlar") {
//         await setMode(userId, "catalog");
//         await sendProductsList(bot, chatId, { category: null, page: 1 });
//         return;
//     }

//     // siz keyboard’da "📂 Kategoriya bo‘yicha" deb turibdi
//     if (text === "📂 Kategoriya bo‘yicha") {
//         await setMode(userId, "catalog");

//         const cats = await listCategories();
//         if (!cats.length) return bot.sendMessage(chatId, "📂 Kategoriyalar yo‘q.");

//         // faqat unique + normal
//         const uniq = Array.from(new Set(cats.map(c => String(c).trim()).filter(Boolean)));

//         const kb = uniq.map(c => [{ text: `📁 ${c}` }]);
//         kb.push([{ text: "⬅️ Menyu" }]);

//         return bot.sendMessage(chatId, "📂 Kategoriyani tanlang:", {
//             reply_markup: { keyboard: kb, resize_keyboard: true, one_time_keyboard: true },
//         });
//     }

//     // category chosen (📁 tortlar)
//     if (text.startsWith("📁 ")) {
//         await setMode(userId, "catalog");
//         const cat = normCatFromBtn(text);
//         await sendProductsList(bot, chatId, { category: cat, page: 1 });
//         return;
//     }

//     if (text === "➕ Mahsulot qo‘shish") {
//         await setMode(userId, "product_add");
//         await startProductAdd(redis, userId);
//         return bot.sendMessage(chatId, "➕ Mahsulot qo‘shish.\n🍰 Mahsulot nomini yozing (masalan: Napoleon)");
//     }

//     if (text === "⬅️ Menyu") {
//         await setMode(userId, "menu");
//         return bot.sendMessage(chatId, "Menyu:", { reply_markup: mainMenuKeyboard() });
//     }

//     if (text === "❌ Bekor") {
//         await clearDraft(redis, userId);
//         await setMode(userId, "menu");
//         return bot.sendMessage(chatId, "✅ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
//     }

//     /* ================= DEFAULT: expense/sale ================= */

//     const currentMode = mode === "menu" || !mode ? null : mode;
//     const seller = { tgId: userId, tgName: getUserName(msg) };
//     const hasMoney = /\d/.test(text);

//     if (currentMode === "expense") {
//         const exp = parseExpenseMessage(text);
//         if (!exp) return bot.sendMessage(chatId, "❌ Chiqim topilmadi. Misol: Svetga 100000");

//         const saved = await saveExpenseWithTx({ spender: seller, title: exp.title, amount: exp.amount });

//         const notify = expenseNotifyText({
//             spenderName: seller.tgName,
//             title: saved.title,
//             amount: saved.amount,
//         });

//         await bot.sendMessage(
//             chatId,
//             `✅ Chiqim saqlandi: -${formatMoney(saved.amount)} so'm\n🧾 Tartib: <code>#${saved.orderNo}</code>`,
//             {
//                 parse_mode: "HTML",
//                 reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish", callback_data: "del:start" }]] },
//             }
//         );

//         await sendToGroup(bot, notify);
//         return;
//     }

//     if (currentMode === "sale" || hasMoney) {
//         const parsed = parseSaleMessage(text);
//         if (!parsed.items.length) {
//             return bot.sendMessage(chatId, "❌ Sotuv topilmadi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000");
//         }

//         const { sale, debtDoc } = await saveSaleWithTx({
//             seller,
//             items: parsed.items,
//             phone: parsed.phone,
//         });
//         for (const item of sale.items) {
//             // item.productId bo'lsa shuni bering
//             await deleteChannelPostIfOutOfStock(bot, item.productId);
//         }

//         const notify = saleNotifyText({
//             sellerName: seller.tgName,
//             itemsText: (sale.items || [])
//                 .map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`)
//                 .join(", "),
//             paidTotal: sale.paidTotal,
//             debtTotal: sale.debtTotal,
//             phone: sale.phone,
//         });

//         await bot.sendMessage(
//             chatId,
//             `✅ Sotuv saqlandi.\nTushgan: ${formatMoney(sale.paidTotal)} so'm\n🧾 Tartib N: <code>#${sale.orderNo}</code>` +
//             (sale.debtTotal > 0 ? `\nQarz: ${formatMoney(sale.debtTotal)} so'm` : ""),
//             {
//                 parse_mode: "HTML",
//                 reply_markup: { inline_keyboard: [[{ text: "🗑 O‘chirish", callback_data: "del:start" }]] },
//             }
//         );

//         await sendToGroup(bot, notify);

//         if (debtDoc) {
//             await bot.sendMessage(
//                 chatId,
//                 `📌 Qarz yaratildi: <b>${formatMoney(debtDoc.remainingDebt)}</b> so'm`,
//                 { parse_mode: "HTML" }
//             );
//         }

//         return;
//     }

//     return bot.sendMessage(
//         chatId,
//         "ℹ️ Menyu tugmalaridan birini tanlang yoki Yordam’ni bosing.",
//         { reply_markup: mainMenuKeyboard() }
//     );
// }

// module.exports = { onMessage };

