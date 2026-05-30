// src/handlers/onMessage.js
const dayjs = require("dayjs");
const Debt   = require("../models/Debt");
const Worker = require("../models/Worker");

const {
    mainMenuKeyboard, startKeyboard, monthKeyboard,
    saleInputModeKeyboard, menuKeyboard, usersKeyboard, addWorkerKeyboard, webAppButtons
} = require("../keyboards");
const { WEBAPP_URL } = require("../config");

const { ADMIN_TG_ID } = require("../config");
const { isAuthed, setMode, getMode, redis }   = require("../services/auth");
const { isAdmin, showBalanceEdit, handleBalanceEditMessage } = require("../logic/balanceEditFlow");
const { sendBackupToTelegram } = require("../services/backup");
const { handleSharedContact, handleForwardedUser, handleTgIdWorkerAdd } = require("../logic/addWorkerFlow");
const { startCashbackFlow, handleCashbackMessage } = require("../logic/cashbackFlow");
const { handleExpenseReportMenu } = require("./message/expenseReportRouter");
const { closeCashAndMakeReport } = require("../services/closeCash");
const { sendToGroup }  = require("../services/notify");
const { closeNotifyText, debtPayNotifyText } = require("../utils/report");
const { payDebt }      = require("../services/debtPay");
const { formatMoney }  = require("../utils/money");
const { helpText }     = require("../utils/helpText");
const { handleDeleteMessage } = require("../logic/deleteFlow");
const { getUserName, formatDebtCard, debtPayButton, escapeHtml } = require("../logic/ui");
const { startExpense, onExpenseMessage }   = require("./expenseFlow");
const { startPurchase, onPurchaseMessage } = require("./purchaseFlow");
const { handleWebAppOrder }  = require("./message/webappOrder");
const { processSaleInput }   = require("./message/saleMessage");
const { routeVoiceMessage }  = require("./message/voiceRouter");
const { handleTopCommands, handlePasswordStep } = require("./message/commands");

async function onMessage(bot, msg) {
    const chatId     = msg.chat.id;
    const userId     = msg.from?.id;
    const text       = String(msg.text || "").trim();
    const hasVoice   = !!msg.voice;
    const hasContact = !!msg.contact;
    const hasForward = !!msg.forward_from;

    // ── WebApp order (authentication-free)
    if (await handleWebAppOrder(bot, msg)) return;
    if (!userId) return;

    // ── Expense hisobot router (ham authentication tekshiradi ichida)
    if (await handleExpenseReportMenu(bot, msg)) return;

    // ══════════════════════════════════════════
    //  CONTACT ULASHISH — faqat add_worker rejimida
    // ══════════════════════════════════════════
    if (hasContact) {
        if (!(await isAuthed(userId))) return;
        const mode = await getMode(userId);
        if (mode === "add_worker") {
            await handleSharedContact(bot, msg);
        } else {
            await bot.sendMessage(
                chatId,
                "ℹ️ Kontakt qabul qilindi, lekin siz foydalanuvchi qo'shish rejimida emassiz.\n" +
                "Menyu → Foydalanuvchilar → ➕ Foydalanuvchi qo'shish",
                { reply_markup: mainMenuKeyboard() }
            );
        }
        return;
    }

    // ── Forward orqali worker qo'shish
    if (hasForward && !text.startsWith("/")) {
        if (!(await isAuthed(userId))) return;
        const mode = await getMode(userId);
        if (mode === "add_worker") {
            await handleForwardedUser(bot, msg);
            return;
        }
    }

    if (!text && !hasVoice) return;

    // ── Top commands (/start, /tozalash)
    if (await handleTopCommands(bot, msg)) return;

    // ── Delete flow
    const del = await handleDeleteMessage(bot, chatId, userId, text);
    if (del?.handled) return;

    // ── Cashback flow
    const cb = await handleCashbackMessage(bot, chatId, userId, text);
    if (cb?.handled) return;

    const mode = await getMode(userId);

    // ── Parol
    if (await handlePasswordStep(bot, msg, mode)) return;

    // ── Auth tekshirish
    if (!(await isAuthed(userId))) {
        return bot.sendMessage(chatId, "🔒 Avval /start bosing.", startKeyboard());
    }

    // ── Voice
    if (hasVoice) return routeVoiceMessage(bot, msg);

    // ── Admin: balans tahrirlash xabari
    if (isAdmin(userId)) {
        if (await handleBalanceEditMessage(bot, msg)) return;
    }

    // ══════════════════════════════════════════
    //  ADD_WORKER rejimida TG ID raqami yozilsa
    // ══════════════════════════════════════════
    if (mode === "add_worker") {
        // Faqat raqamdan iborat bo'lsa — TG ID sifatida qabul qilamiz
        if (/^\d{5,12}$/.test(text)) {
            const handled = await handleTgIdWorkerAdd(bot, chatId, userId, text);
            if (handled) return;
        }
        // Boshqa yozuv kelsa — eslatma
        if (text !== "⬅️ Orqaga" && text !== "📋 Menyu" && !text.startsWith("/")) {
            await bot.sendMessage(
                chatId,
                "👤 Siz foydalanuvchi qo'shish rejimida turibsiz.\n\n" +
                "• <b>Kontakt ulashing</b> tugmasini bosing\n" +
                "• Yoki TG ID raqamini yozing (masalan: <code>123456789</code>)\n" +
                "• Yoki xabarini <b>forward</b> qiling\n\n" +
                "Bekor qilish: /tozalash",
                { parse_mode: "HTML", reply_markup: addWorkerKeyboard() }
            );
            return;
        }
    }

    // ── Qarz to'lash
    const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
    if (awaitingDebtId) {
        const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
        if (!amount) return bot.sendMessage(chatId, "❌ Summa noto'g'ri. Masalan: 30000");

        const payer = { tgId: userId, tgName: getUserName(msg) };
        const debt  = await Debt.findById(awaitingDebtId);
        if (!debt) {
            await redis.del(`await_pay_amount:${userId}`);
            return bot.sendMessage(chatId, "❌ Qarz topilmadi.");
        }

        const { debt: updated, actualPay } = await payDebt({ debtId: awaitingDebtId, amount, payer });
        await redis.del(`await_pay_amount:${userId}`);

        let phone = debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null;
        if (phone?.length === 9) phone = "998" + phone;

        await bot.sendMessage(
            chatId,
            `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
            { parse_mode: "HTML" }
        );
        if (updated.isClosed) await bot.sendMessage(chatId, "✅ Qarz to'liq yopildi");
        await sendToGroup(bot, debtPayNotifyText({
            payerName: payer.tgName, note: debt.note || "-",
            phone, paid: actualPay, remaining: updated.remainingDebt
        }));
        return;
    }

    // ── Purchase flow
    if (await onPurchaseMessage(bot, msg)) return;

    // ── Expense flow
    if (await onExpenseMessage(bot, msg)) return;

    // ══════════════════════════════════════════
    //  MENYU TUGMALARI
    // ══════════════════════════════════════════
    const admin = isAdmin(userId);

    if (text === "🎁 Kashback orqali xarid") {
        await startCashbackFlow(bot, chatId, userId);
        return;
    }
    if (text === "🧁 Sotish") {
        await setMode(userId, "sale");
        return bot.sendMessage(
            chatId,
            "Sotuvni yozing.\n\nMasalan:\nTort Shekoladniy 140000, Pepsi 17000\n\nYoki pastdagi tugma orqali nomlardan tanlang:",
            { reply_markup: saleInputModeKeyboard() }
        );
    }
    if (text === "💸 Chiqim")            return startExpense(bot, chatId, userId);
    if (text === "📦 Kirim (Taminot)")   return startPurchase(bot, chatId, userId);

    if (text === "📌 Qarzlar") {
        const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(50);
        if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo'q.");
        await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
        for (const d of debts) {
            await bot.sendMessage(chatId, formatDebtCard(d), { parse_mode: "HTML", ...debtPayButton(d._id) });
        }
        return;
    }
    if (text === "📆 Oylik hisobot") {
        const year = dayjs().year();
        return bot.sendMessage(chatId, `📆 Oy tanlang (${year}):`, { reply_markup: monthKeyboard(year) });
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
        await bot.sendMessage(chatId, "📋 Qo'shimcha menyu:", { reply_markup: menuKeyboard(admin) });

        // WebApp tugmalari
        const waBtns = webAppButtons(WEBAPP_URL);
        if (waBtns) {
            const waText = "📱 Ilova: Dashboard va Offline rejim!\nOffline rejimni yuklab oling.";
            await bot.sendMessage(chatId, waText, { reply_markup: waBtns });
        }
        return;
    }
    if (text === "⬅️ Orqaga") {
        await setMode(userId, "sale");
        return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenuKeyboard() });
    }

    // ── ADMIN ONLY: Balans tahrirlash
    // ── ADMIN: Qo'lda backup
    if (text === "📤 Backup yuborish") {
        if (!admin) return bot.sendMessage(chatId, "⛔ Ruxsat yo'q.");
        await bot.sendMessage(chatId, "⏳ Backup tayyorlanmoqda...");
        const res = await sendBackupToTelegram(bot);
        if (res.ok) {
            return bot.sendMessage(chatId, `✅ Backup yuborildi!\n📊 ${res.totalDocs} ta hujjat → ${res.fileName}`);
        } else {
            return bot.sendMessage(chatId, `❌ Backup xatolik: ${res.reason}`);
        }
    }

    if (text === "💰 Balansni tahrirlash") {
        if (!admin) return bot.sendMessage(chatId, "⛔ Ruxsat yo'q.");
        await showBalanceEdit(bot, chatId, userId);
        return;
    }

    if (text === "👥 Foydalanuvchilar") {
        return bot.sendMessage(chatId, "Foydalanuvchilar boshqaruvi:", { reply_markup: usersKeyboard() });
    }

    // ── Foydalanuvchi qo'shish
    if (text === "➕ Foydalanuvchi qo'shish") {
        await setMode(userId, "add_worker");
        return bot.sendMessage(
            chatId,
            "👤 <b>Foydalanuvchi qo'shish</b>\n\n" +
            "<b>3 usul mavjud:</b>\n\n" +
            "📱 <b>1-usul (eng qulay):</b>\n" +
            "  Pastdagi <b>«📱 Kontakt ulashing»</b> tugmasini bosing\n\n" +
            "📨 <b>2-usul:</b>\n" +
            "  O'sha odamning istalgan xabarini <b>forward</b> qiling\n\n" +
            "🔢 <b>3-usul:</b>\n" +
            "  Foydalanuvchining <b>Telegram ID</b> raqamini yozing\n" +
            "  ID bilish uchun: @userinfobot botiga /start yuboring",
            { parse_mode: "HTML", reply_markup: addWorkerKeyboard() }
        );
    }

    // ── Foydalanuvchilar ro'yxati
    if (text === "📋 Foydalanuvchilar ro'yxati") {
        const workers = await Worker.find().sort({ createdAt: -1 });
        if (!workers.length) return bot.sendMessage(chatId, "Foydalanuvchilar topilmadi");
        for (const w of workers) {
            const status     = w.isActive ? "🟢 Aktiv" : "🔴 Nofaol";
            const adminBadge = Number(w.tgId) === Number(ADMIN_TG_ID) ? " 👑" : "";
            await bot.sendMessage(
                chatId,
                `👤 <b>${escapeHtml(w.fullName || "Noma'lum")}</b>${adminBadge}\n` +
                `🆔 <code>${w.tgId}</code>\n` +
                `📛 @${w.username || "—"}\n` +
                status,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: w.isActive ? "🔴 Nofaol" : "🟢 Faol", callback_data: `toggle_worker:${w._id}` },
                            { text: "🗑 O'chirish",                         callback_data: `del_worker:${w._id}` }
                        ]]
                    }
                }
            );
        }
        return;
    }

    // ── Default: sotuv rejimi
    const seller = { tgId: userId, tgName: getUserName(msg) };
    return processSaleInput(bot, msg, text, seller, { tryAI: false });
}

module.exports = { onMessage };
