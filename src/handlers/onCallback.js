// src/bot/handlers/onCallback.js
// NEW CLEAN VERSION (one flow, no duplicate cases, caption/text safe edits)
// ✅ Added: cart jump hint ("👇 Savat yangilandi") + no-duplicate hint + cart delete before sending list

const Debt = require("../models/Debt");
const Product = require("../models/Product");

const { redis } = require("../services/auth");
const cartService = require("../services/cartService");
const { payDebt } = require("../services/debtPay");
const { makeMonthlyReport } = require("../services/monthlyReport");
const { sendToGroup } = require("../services/notify");
const { handleWizardCallback } = require("../services/productWizard");

const { listProducts, listByCategory, getById, listCategories } = require("../services/productService");

const { debtPayNotifyText } = require("../utils/report");
const { formatMoney } = require("../utils/money");
const { escapeHtml, getUserName } = require("../helpers/text");

const { deleteCartMessage, tryPinCart, sendNewCartMessage } = require("../helpers/cartDock");
const { formatCart } = require("../services/cartFormat");
const { editSmart } = require("../helpers/tgEdit");

const {
    catalogKeyboard,
    categoryKeyboard,
    productAddKeyboard,
} = require("../keyboards");

const { CHANNEL_ID } = require("../config");

/* ================= helpers ================= */

function payAmountKeyboard(debtId) {
    return {
        inline_keyboard: [
            [{ text: "To'liq to'lash", callback_data: `payfull:${debtId}` }],
            [{ text: "Qisman to'lash", callback_data: `paypart:${debtId}` }],
        ],
    };
}

function productCard(p) {
    const title = `🍰 <b>${escapeHtml(p.name)}</b>`;
    const cat = `📁 ${escapeHtml(p.category)}`;
    const price = `💰 ${formatMoney(p.salePrice)} so'm`;
    const qty = `📦 ${p.qty} ta`;
    const code = p.code ? `🧾 <b>${escapeHtml(p.code)}</b>` : "";
    const desc = p.desc ? `📝 ${escapeHtml(p.desc)}` : "";
    return [code, title, cat, price, qty, desc].filter(Boolean).join("\n");
}

// ✅ cart keyboard: har itemga ➖ qty ➕
function cartKeyboard(items) {
    const rows = [];
    for (const it of items) {
        const pid = String(it.product._id);
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

// ✅ Hint message (jump to cart) — eski hintni o'chirib turamiz
async function sendCartJumpHint(bot, chatId, cartMessageId) {
    const hintKey = `cart_hint:${String(chatId)}`;
    const oldHint = await redis.get(hintKey);

    if (oldHint) {
        try { await bot.deleteMessage(chatId, Number(oldHint)); } catch { }
        await redis.del(hintKey);
    }

    try {
        const hint = await bot.sendMessage(chatId, "Savat yangilandi", {
            reply_to_message_id: cartMessageId,
        });
        await redis.set(hintKey, String(hint.message_id), "EX", 3600);
    } catch { }
}

async function showCategoriesPage(bot, q) {
    let kb;
    try {
        kb = categoryKeyboard();
    } catch {
        const cats = await listCategories();
        kb = { inline_keyboard: (cats || []).map((c) => [{ text: c, callback_data: `cat:${c}` }]) };
    }

    await editSmart(bot, q, {
        text: "📂 Kategoriya tanlang:",
        reply_markup: kb,
    });
}

async function sendProductsList(bot, chatId, { category = null, page = 1 } = {}) {
    const limit = 10;
    const { items, pages } = await listProducts({
        category: category || undefined,
        page,
        limit,
    });

    if (!items || !items.length) {
        return bot.sendMessage(
            chatId,
            category ? "📦 Bu kategoriyada mahsulot yo‘q." : "📦 Mahsulotlar yo‘q."
        );
    }

    for (const p of items) {
        const kb = {
            inline_keyboard: [[
                { text: "🗑 O‘chirish", callback_data: `pdel:${p._id}` },
                { text: "⏳ Muddati o‘tgan", callback_data: `pexp:${p._id}` },
            ]],
        };

        if (p.photo?.tgFileId) {
            await bot.sendPhoto(chatId, p.photo.tgFileId, {
                caption: productCard(p),
                parse_mode: "HTML",
                reply_markup: kb,
            });
        } else {
            await bot.sendMessage(chatId, productCard(p), {
                parse_mode: "HTML",
                reply_markup: kb,
            });
        }
    }

    const navRow = [];
    const catKey = category ? String(category).toLowerCase() : "all";
    if (page > 1) navRow.push({ text: "⬅️ Oldingi", callback_data: `plist:${catKey}:${page - 1}` });
    if (page < pages) navRow.push({ text: "➡️ Keyingi", callback_data: `plist:${catKey}:${page + 1}` });

    if (navRow.length) {
        await bot.sendMessage(chatId, "📄 Sahifa:", {
            reply_markup: { inline_keyboard: [navRow] },
        });
    }
}

/* ================= main ================= */

async function onCallback(bot, q) {
    const msg = q.message;
    const chatId = msg?.chat?.id;
    const from = q.from;

    const seller = { tgId: from.id, tgName: getUserName({ from }) };

    await bot.answerCallbackQuery(q.id).catch(() => { });

    try {
        // 1) WIZARD CALLBACK FIRST
        const wizardHandled = await handleWizardCallback({
            bot,
            redis,
            q,
            userId: from.id,
            chatId,
            channelId: CHANNEL_ID,
            getUserName,
            catalogKeyboard,
        });
        if (wizardHandled) return;

        const data = q.data || "";

        /* ================= PRODUCTS: pagination ================= */
        if (data.startsWith("plist:")) {
            const [, catKey, pageStr] = data.split(":");
            const page = Math.max(1, parseInt(pageStr, 10) || 1);
            const category = catKey === "all" ? null : catKey;

            await sendProductsList(bot, chatId, { category, page });
            return;
        }

        /* ================= PRODUCT ADMIN: delete/expired start ================= */
        if (data.startsWith("pdel:") || data.startsWith("pexp:")) {
            const [actionKey, id] = data.split(":");
            const action = actionKey === "pexp" ? "expired" : "delete";

            await redis.set(
                `prod_del_pending:${from.id}`,
                JSON.stringify({ action, productId: id }),
                "EX",
                600
            );

            await bot.sendMessage(
                chatId,
                action === "expired"
                    ? "✍️ Muddati o‘tgan sababi? (matn yozing)"
                    : "✍️ O‘chirish sababi? (matn yozing)"
            );
            return;
        }

        /* ================= debt pay ================= */
        if (data.startsWith("pay:")) {
            const debtId = data.split(":")[1];
            const debt = await Debt.findById(debtId);
            if (!debt) {
                await bot.answerCallbackQuery(q.id, { text: "Qarz topilmadi" }).catch(() => { });
                return;
            }

            await bot.sendMessage(
                chatId,
                `📌 Qarz: <b>${escapeHtml(debt.note || "-")}</b>\nQolgan: <b>${formatMoney(debt.remainingDebt)}</b> so'm\nQanday to'laysiz?`,
                { parse_mode: "HTML", reply_markup: payAmountKeyboard(debtId) }
            );
            return;
        }

        if (data.startsWith("payfull:")) {
            const debtId = data.split(":")[1];
            const debt = await Debt.findById(debtId);
            if (!debt) {
                await bot.answerCallbackQuery(q.id, { text: "Qarz topilmadi" }).catch(() => { });
                return;
            }

            const { debt: updated, actualPay } = await payDebt({
                debtId,
                amount: debt.remainingDebt,
                payer: seller,
            });

            const notify = debtPayNotifyText({
                payerName: seller.tgName,
                note: debt.note || "-",
                phone: debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null,
                paid: actualPay,
                remaining: updated.remainingDebt,
            });

            await bot.sendMessage(
                chatId,
                `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
                { parse_mode: "HTML" }
            );

            await sendToGroup(bot, notify);
            return;
        }

        if (data.startsWith("paypart:")) {
            const debtId = data.split(":")[1];
            await redis.set(`await_pay_amount:${from.id}`, debtId, "EX", 300);
            await bot.sendMessage(chatId, "✍️ Qancha to'laysiz? (masalan: 30000)");
            return;
        }

        /* ================= report month ================= */
        if (data.startsWith("rep_month:")) {
            const [, y, m] = data.split(":");
            const year = parseInt(y, 10);
            const monthIndex = parseInt(m, 10);

            const rep = await makeMonthlyReport(year, monthIndex);

            const textMsg =
                `📆 <b>Oylik hisobot: ${rep.monthTitle}</b>\n\n` +
                `💰 Sotuvdan tushgan: <b>${formatMoney(rep.saleSum)}</b> so'm\n` +
                `💸 Chiqimlar: <b>${formatMoney(rep.expenseSum)}</b> so'm\n` +
                `📌 Ochiq qarz (qolgan): <b>${formatMoney(rep.debtSum)}</b> so'm\n` +
                `🏦 Kassa balansi: <b>${formatMoney(rep.balance)}</b> so'm`;

            await bot.sendMessage(chatId, textMsg, { parse_mode: "HTML" });
            await bot.sendDocument(chatId, rep.filePath, { caption: `📄 ${rep.fileName}` });
            return;
        }

        /* ================= delete start (sale/expense) ================= */
        if (data === "del:start") {
            await redis.set(`del_mode:${from.id}`, "await_order", "EX", 300);
            await bot.sendMessage(chatId, "🧾 Tartib raqamini yozing! (masalan: #0009)");
            return;
        }

        /* ================= product info (send to private) ================= */
        if (data.startsWith("pinfo:")) {
            const id = data.split(":")[1];
            const p = await Product.findById(id);

            if (!p || p.isDeleted || !p.isActive) {
                await bot.answerCallbackQuery(q.id, { text: "Mahsulot topilmadi" }).catch(() => { });
                return;
            }

            const textMsg =
                `🍰 <b>${escapeHtml(p.name)}</b>\n` +
                `📁 <b>Kategoriya:</b> ${escapeHtml(p.category)}\n` +
                `💰 <b>Narx:</b> ${formatMoney(p.salePrice)} so'm\n` +
                (p.desc ? `📝 ${escapeHtml(p.desc)}\n` : "") +
                (p.code ? `🧾 <b>Kod:</b> ${escapeHtml(p.code)}\n` : "") +
                `📦 <b>Mavjud:</b> ${p.qty} ta`;

            const userChatId = q.from.id;

            if (p.photo?.tgFileId) {
                await bot.sendPhoto(userChatId, p.photo.tgFileId, {
                    caption: textMsg,
                    parse_mode: "HTML",
                });
            } else {
                await bot.sendMessage(userChatId, textMsg, { parse_mode: "HTML" });
            }

            await bot.answerCallbackQuery(q.id, { text: "✅ Lichkaga yuborildi" }).catch(() => { });
            return;
        }

        /* ================= order ================= */
        if (data.startsWith("order:")) {
            const id = data.split(":")[1];
            await bot.sendMessage(
                q.from.id,
                "🛒 Zakaz uchun yozing:\nMasalan:\n" +
                `<b>#${id}</b> 2ta tel 901234567\n\n` +
                "Yoki shunchaki telefon yuboring, admin aloqaga chiqadi.",
                { parse_mode: "HTML" }
            );
            return;
        }

        /* ================= CUSTOMER FLOW: categories -> products -> cart ================= */

        if (data === "back_to_cat") {
            await showCategoriesPage(bot, q);
            return;
        }

        // category selected
        if (data.startsWith("cat:")) {
            const category = data.slice(4);
            const products = await listByCategory(category);

            if (!products || !products.length) {
                await editSmart(bot, q, {
                    text: "❌ Bu kategoriyada mahsulot yo‘q",
                    reply_markup: categoryKeyboard(),
                });
                return;
            }

            // ✅ Kategoriya/mahsulotlar chiqishidan oldin eski savatni olib tashlaymiz
            await deleteCartMessage(bot, redis, chatId);

            await editSmart(bot, q, {
                text: `📦 <b>${escapeHtml(category)}</b> — mahsulotlar:`,
                reply_markup: categoryKeyboard(),
            });

            for (const p of products) {
                const caption =
                    `🍰 <b>${escapeHtml(p.name)}</b>\n` +
                    `💰 ${formatMoney(p.salePrice)} so‘m\n` +
                    `📦 Qoldiq: ${p.qty}`;

                if (p.photo?.tgFileId) {
                    await bot.sendPhoto(chatId, p.photo.tgFileId, {
                        caption,
                        parse_mode: "HTML",
                        reply_markup: productAddKeyboard(p._id),
                    });
                } else if (p.photo?.url) {
                    await bot.sendPhoto(chatId, p.photo.url, {
                        caption,
                        parse_mode: "HTML",
                        reply_markup: productAddKeyboard(p._id),
                    });
                } else {
                    await bot.sendMessage(chatId, caption, {
                        parse_mode: "HTML",
                        reply_markup: productAddKeyboard(p._id),
                    });
                }
            }

            // ✅ savat bo'lsa, yana pastga chiqaramiz + hint
            const items = cartService.listItems(chatId);
            if (items.length) {
                const totals = cartService.calcTotals(chatId);
                const mid = await sendNewCartMessage(
                    bot,
                    redis,
                    chatId,
                    formatCart(items, totals),
                    cartKeyboard(items)
                );
                await tryPinCart(bot, chatId, mid);
                await sendCartJumpHint(bot, chatId, mid);
            }

            return;
        }

        // add to cart
        if (data.startsWith("add:")) {
            const productId = data.slice(4);
            const product = await getById(productId);

            if (!product || product.qty <= 0) {
                await bot.answerCallbackQuery(q.id, { text: "❌ Mahsulot mavjud emas" });
                return;
            }

            cartService.addToCart(chatId, product);

            // ✅ narx yozib o'zgartirish uchun state
            cartService.setState(chatId, { mode: "await_last_price" });

            const items = cartService.listItems(chatId);
            const totals = cartService.calcTotals(chatId);

            await deleteCartMessage(bot, redis, chatId);

            const mid = await sendNewCartMessage(
                bot,
                redis,
                chatId,
                formatCart(items, totals),
                cartKeyboard(items)
            );

            await tryPinCart(bot, chatId, mid);
            await sendCartJumpHint(bot, chatId, mid);

            await bot.answerCallbackQuery(q.id, { text: "✅ Savatga qo‘shildi" });
            return;
        }

        if (data.startsWith("cart:inc:")) {
            const pid = data.split(":")[2];
            cartService.incQty(chatId, pid);

            const items = cartService.listItems(chatId);
            const totals = cartService.calcTotals(chatId);

            await deleteCartMessage(bot, redis, chatId);

            const mid = await sendNewCartMessage(
                bot,
                redis,
                chatId,
                formatCart(items, totals),
                cartKeyboard(items)
            );

            await tryPinCart(bot, chatId, mid);
            await sendCartJumpHint(bot, chatId, mid);

            await bot.answerCallbackQuery(q.id);
            return;
        }

        if (data.startsWith("cart:dec:")) {
            const pid = data.split(":")[2];
            cartService.decQty(chatId, pid);

            const items = cartService.listItems(chatId);
            const totals = cartService.calcTotals(chatId);

            await deleteCartMessage(bot, redis, chatId);

            if (items.length) {
                const mid = await sendNewCartMessage(
                    bot,
                    redis,
                    chatId,
                    formatCart(items, totals),
                    cartKeyboard(items)
                );
                await tryPinCart(bot, chatId, mid);
                await sendCartJumpHint(bot, chatId, mid);
            }

            await bot.answerCallbackQuery(q.id);
            return;
        }

        if (data === "noop") {
            await bot.answerCallbackQuery(q.id);
            return;
        }

        // sell (stub)
        if (data === "sell") {
            await bot.sendMessage(chatId, "✅ Sotish yakunlandi (service ulanadi)");
            return;
        }

        await bot.answerCallbackQuery(q.id).catch(() => { });
    } catch (e) {
        console.error("onCallback error:", e?.response?.body || e);
        if (chatId) await bot.sendMessage(chatId, "⚠️ Xatolik: qayta urinib ko‘ring.").catch(() => { });
        await bot.answerCallbackQuery(q.id).catch(() => { });
    }
}

module.exports = { onCallback };