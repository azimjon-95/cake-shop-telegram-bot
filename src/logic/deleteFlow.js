// src/logic/deleteFlow.js
const Sale = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt = require("../models/Debt");
const Supplier = require("../models/Supplier");
const { addBalance } = require("./storage");
const { escapeHtml } = require("./ui");
const { formatMoney } = require("../utils/money");
const { sendToGroup } = require("../services/notify");
const { redis } = require("../services/auth");
const { currentBranch, sameBranch, normBranch } = require("../services/branches");
const { applySupplierDebtDelta } = require("../services/branchData");
const { ADMIN_TG_ID } = require("../config");

const isAdminId = (id) => !!(ADMIN_TG_ID && Number(id) === Number(ADMIN_TG_ID));
// Boshqa filial yozuvini faqat admin o'chira oladi
const canTouch = (doc, userId) => isAdminId(userId) || sameBranch(doc?.branchId, currentBranch());

async function startDeleteFlow(bot, chatId, userId, type, docId, orderNo) {
    await redis.set(
        `await_del:${userId}`,
        JSON.stringify({ step: "confirm", type, id: docId, orderNo }),
        "EX",
        300
    );
    const label = type === "sale" ? "Sotuvni" : "Chiqimni";
    await bot.sendMessage(chatId, `🗑 <b>${label} o‘chirish</b>\nTasdiqlash uchun ID ni yozing: <code>${orderNo}</code>`, { parse_mode: "HTML" });
}

async function handleDeleteMessage(bot, chatId, userId, text) {
    const raw = await redis.get(`await_del:${userId}`);
    if (!raw) return { handled: false };

    let st = null;
    try { st = JSON.parse(raw); } catch { }
    if (!st) {
        await redis.del(`await_del:${userId}`);
        await bot.sendMessage(chatId, "⚠️ Delete holati buzildi. Qayta urinib ko‘ring.");
        return { handled: true };
    }

    if (st.step === "confirm") {
        const typed = String(text || "").replace(/[^\d]/g, "");
        const need = String(st.orderNo || "").replace(/[^\d]/g, "");
        if (typed !== need) {
            await bot.sendMessage(chatId, `❌ ID noto‘g‘ri. To‘g‘ri ID: <code>${st.orderNo}</code>`, { parse_mode: "HTML" });
            return { handled: true };
        }
        st.step = "reason";
        await redis.set(`await_del:${userId}`, JSON.stringify(st), "EX", 300);
        await bot.sendMessage(chatId, "✍️ O‘chirish sababini yozing (qisqa):");
        return { handled: true };
    }

    if (st.step === "reason") {
        const reason = String(text || "").trim();
        if (reason.length < 3) {
            await bot.sendMessage(chatId, "❌ Sabab juda qisqa. Kamida 3 ta belgi yozing.");
            return { handled: true };
        }

        await redis.del(`await_del:${userId}`);

        if (st.type === "expense") {
            const exp = await Expense.findById(st.id);
            if (!exp) {
                await bot.sendMessage(chatId, "❌ Chiqim topilmadi.");
                return { handled: true };
            }

            if (!canTouch(exp, userId)) {
                await bot.sendMessage(chatId, "⛔ Bu chiqim boshqa filialga tegishli.");
                return { handled: true };
            }
            const expBranch = normBranch(exp.branchId);

            // ✅ 1) balansni qaytaramiz (chiqim o‘chdi => pul o'sha filialga qaytdi)
            await addBalance(Number(exp.amount || 0), null, expBranch);

            // ✅ 2) agar bu firma to‘lovi bo‘lsa => supplier.debt qaytadi
            if (exp.categoryKey === "supplier" && exp.supplierId) {
                const sup = await Supplier.findById(exp.supplierId);
                if (sup) {
                    applySupplierDebtDelta(sup, expBranch, Number(exp.amount || 0));
                    await sup.save();
                }
            }

            // ✅ 3) chiqimni o‘chiramiz
            await Expense.deleteOne({ _id: exp._id });

            await bot.sendMessage(chatId, `✅ Chiqim o‘chirildi.\n🆔 ID: ${exp.orderNo}`);

            // ✅ 4) groupga ham yozamiz
            await sendToGroup(
                bot,
                `🗑 <b>CHIQIM O‘CHIRILDI</b>\n` +
                `🆔 ID: <code>${exp.orderNo}</code>\n` +
                `👤 Kim: <b>${escapeHtml(exp.spender?.tgName || "-")}</b>\n` +
                `🧾 Nima: <b>${escapeHtml(exp.categoryKey || "other")} | ${escapeHtml(exp.title || "-")}</b>\n` +
                `💸 Summa: <b>-${formatMoney(exp.amount)}</b> so'm\n` +
                `📝 Sabab: <b>${escapeHtml(reason)}</b>`,
                { parse_mode: "HTML", branchId: expBranch }
            );

            return { handled: true };
        }

        if (st.type === "sale") {
            const sale = await Sale.findById(st.id);
            if (!sale) {
                await bot.sendMessage(chatId, "❌ Sotuv topilmadi.");
                return { handled: true };
            }

            if (!canTouch(sale, userId)) {
                await bot.sendMessage(chatId, "⛔ Bu sotuv boshqa filialga tegishli.");
                return { handled: true };
            }
            const saleBranch = normBranch(sale.branchId);

            const debt = await Debt.findOne({ saleId: sale._id });
            if (debt && (debt.payments || []).length > 0) {
                await bot.sendMessage(chatId, "❌ Bu sotuv bo‘yicha qarz to‘lovi bor. O‘chirish mumkin emas.");
                return { handled: true };
            }

            await addBalance(-Number(sale.paidTotal || 0), null, saleBranch);
            if (debt) await Debt.deleteOne({ _id: debt._id });
            await Sale.deleteOne({ _id: sale._id });

            await bot.sendMessage(chatId, `✅ Sotuv o‘chirildi.\n🆔 ID: ${sale.orderNo}`);

            await sendToGroup(
                bot,
                `🗑 <b>SOTUV O‘CHIRILDI</b>\n\n` +
                `🆔 ID: <code>${sale.orderNo}</code>\n` +
                `👤 Sotuvchi: <b>${escapeHtml(sale.seller?.tgName || "-")}</b>\n` +
                `💰 Tushgan: <b>${formatMoney(sale.paidTotal)}</b> so'm\n` +
                `📝 Sabab: <b>${escapeHtml(reason)}</b>`,
                { parse_mode: "HTML", branchId: saleBranch }
            );

            return { handled: true };
        }

        await bot.sendMessage(chatId, "⚠️ Noma’lum delete turi.");
        return { handled: true };
    }

    return { handled: false };
}

module.exports = { startDeleteFlow, handleDeleteMessage };
