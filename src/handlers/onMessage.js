const dayjs = require("dayjs");
const Debt = require("../models/Debt");
const Worker = require("../models/Worker");

const { mainMenuKeyboard, startKeyboard, monthKeyboard, saleInputModeKeyboard, menuKeyboard, usersKeyboard } = require("../keyboards");
const { isAuthed, setMode, getMode, redis } = require("../services/auth");
const { startCashbackFlow, handleCashbackMessage } = require("../logic/cashbackFlow");
const { addWorkerFromForward } = require("../logic/addWorkerFromForward");
const { handleExpenseReportMenu } = require("./message/expenseReportRouter");
const { closeCashAndMakeReport } = require("../services/closeCash");
const { sendToGroup } = require("../services/notify");
const { closeNotifyText, debtPayNotifyText } = require("../utils/report");
const { payDebt } = require("../services/debtPay");
const { formatMoney } = require("../utils/money");
const { helpText } = require("../utils/helpText");
const { handleDeleteMessage } = require("../logic/deleteFlow");
const { getUserName, formatDebtCard, debtPayButton } = require("../logic/ui");
const { startExpense, onExpenseMessage } = require("./expenseFlow");
const { startPurchase, onPurchaseMessage } = require("./purchaseFlow");

const { handleWebAppOrder } = require("./message/webappOrder");
const { processSaleInput } = require("./message/saleMessage");
const { routeVoiceMessage } = require("./message/voiceRouter");
const { handleTopCommands, handlePasswordStep } = require("./message/commands");

async function onMessage(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();
    const hasVoice = !!msg.voice;

    const handledExpenseReport = await handleExpenseReportMenu(bot, msg);
    if (handledExpenseReport) return;
    if (!userId) return;
    if (!text && !hasVoice) return;

    if (await handleWebAppOrder(bot, msg)) return;
    if (await handleTopCommands(bot, msg)) return;

    const delHandled = await handleDeleteMessage(bot, chatId, userId, text);
    if (delHandled.handled) return;

    const cb = await handleCashbackMessage(bot, chatId, userId, msg.text);
    if (cb.handled) return;

    const mode = await getMode(userId);
    if (await handlePasswordStep(bot, msg, mode)) return;

    const ok = await isAuthed(userId);
    if (!ok) {
        return bot.sendMessage(chatId, "🔒 Avval /start bosing va parol kiriting.", startKeyboard());
    }

    if (hasVoice) {
        return routeVoiceMessage(bot, msg);
    }

    const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
    if (awaitingDebtId) {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (!amount) {
            return bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 30000");
        }

        const payer = { tgId: userId, tgName: getUserName(msg) };

        const debt = await Debt.findById(awaitingDebtId);
        if (!debt) {
            await redis.del(`await_pay_amount:${userId}`);
            return bot.sendMessage(chatId, "❌ Qarz topilmadi.");
        }

        const { debt: updated, actualPay } = await payDebt({
            debtId: awaitingDebtId,
            amount,
            payer
        });

        await redis.del(`await_pay_amount:${userId}`);

        let phone = debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null;
        if (phone && phone.length === 9) phone = "998" + phone;

        const notify = debtPayNotifyText({
            payerName: payer.tgName,
            note: debt.note || "-",
            phone,
            paid: actualPay,
            remaining: updated.remainingDebt
        });

        await bot.sendMessage(
            chatId,
            `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
            { parse_mode: "HTML" }
        );

        if (updated.isClosed) {
            await bot.sendMessage(chatId, "✅ Qarz to‘liq yopildi");
        }

        await sendToGroup(bot, notify);
        return;
    }

    const purchaseHandled = await onPurchaseMessage(bot, msg);
    if (purchaseHandled) return;

    const expenseHandled = await onExpenseMessage(bot, msg);
    if (expenseHandled) return;

    if (text === "🎁 Kashback orqali xarid") {
        await startCashbackFlow(bot, chatId, userId);
        return;
    }

    if (text === "🧁 Sotish") {
        await setMode(userId, "sale");
        return bot.sendMessage(
            chatId,
            "Sotuvni yozing.\n\nMasalan:\nTort Shekoladniy 100000, Pepsi 17000\n\nYoki pastdagi tugma orqali nomlardan tanlang:",
            { reply_markup: saleInputModeKeyboard() }
        );
    }

    if (text === "💸 Chiqim") return startExpense(bot, chatId, userId);
    if (text === "📦 Kirim (Taminot)") return startPurchase(bot, chatId, userId);

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
            reply_markup: monthKeyboard(year)
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

    if (text === "📋 Menyu") {
        return bot.sendMessage(chatId, "📋 Qo‘shimcha menyu:", { reply_markup: menuKeyboard() });
    }

    if (text === "⬅️ Orqaga") {
        await setMode(userId, "sale");
        return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenuKeyboard() });
    }

    if (text === "👥 Foydalanuvchilar") {
        return bot.sendMessage(chatId, "Foydalanuvchilar boshqaruvi", { reply_markup: usersKeyboard() });
    }

    if (text === "📋 Foydalanuvchilar ro‘yxati") {
        const workers = await Worker.find().sort({ createdAt: -1 });
        if (!workers.length) return bot.sendMessage(chatId, "Foydalanuvchilar topilmadi");

        for (const w of workers) {
            const userText = `👤 ${w.fullName || "Noma'lum"}\n🆔 ${w.tgId}\n📛 @${w.username || "-"}\n🟢 Aktiv: ${w.isActive ? "Ha" : "Yo‘q"}`;
            await bot.sendMessage(chatId, userText, {
                reply_markup: {
                    inline_keyboard: [[{ text: "🗑", callback_data: `del_worker:${w._id}` }]]
                }
            });
        }
        return;
    }

    const seller = { tgId: userId, tgName: getUserName(msg) };
    const currentMode = !mode || mode === "menu" ? "sale" : mode;
    const hasMoney = /\d/.test(text);

    if (currentMode === "sale" || hasMoney) {
        return processSaleInput(bot, msg, text, seller, { tryAI: false });
    }

    return bot.sendMessage(chatId, "ℹ️ Menyu tugmalaridan birini tanlang yoki Yordam’ni bosing.", {
        reply_markup: mainMenuKeyboard()
    });
}

module.exports = { onMessage };