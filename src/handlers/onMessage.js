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
const { closeCashAndMakeReport, sendCloseReportToGroup, buildCloseReportText } = require("../services/closeCash");
const { sendToGroup }  = require("../services/notify");
const { closeNotifyText, debtPayNotifyText } = require("../utils/report");
const { payDebt }      = require("../services/debtPay");
const { formatMoney }  = require("../utils/money");
const { helpText }     = require("../utils/helpText");
const { handleDeleteMessage } = require("../logic/deleteFlow");
const { ensurePinnedMiniAppLinkInGroup } = require("../services/pinMessage");
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

    const hasPhoto     = !!msg.photo;
    const hasVideoNote = !!msg.video_note;

    // Rasm yoki video note — faqat kassa yopish rejimida qabul qilinadi
    if (!text && !hasVoice) {
        if (hasPhoto || hasVideoNote) {
            // Kassa yopish flow uchun o'tkazib yuboramiz
            if (!(await isAuthed(userId))) return;
            const curMode = await getMode(userId);
            if (curMode === "close_cash_photo1" || curMode === "close_cash_photo2") {
                // pastda ushlanadi — davom etadi
            } else {
                return; // boshqa rejimda rasm/video kerak emas
            }
        } else {
            return;
        }
    }

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

    // ══════════════════════════════════════════════
    // 💼 DUKON FOIDASIDAN — eganing shaxsiy olingan pul
    // Qadam 1: Summa so'rash
    // Qadam 2: Tavsif (ixtiyoriy)
    // ══════════════════════════════════════════════
    if (text === "💼 Dukon Foidasidan") {
        await setMode(userId, "owner_withdraw_amount");
        await redis.del(`owner_withdraw:${userId}`);
        return bot.sendMessage(chatId,
            "💼 <b>Dukon Foidasidan</b>\n\n" +
            "💰 <b>Qancha pul oldingiz?</b>\n" +
            "<i>Summani yozing (masalan: 50000, 200000)</i>",
            {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: [
                        [{ text: "50 000" }, { text: "100 000" }, { text: "150 000" }],
                        [{ text: "200 000" }, { text: "300 000" }, { text: "500 000" }],
                        [{ text: "\u274C Bekor qilish" }],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                }
            }
        );
    }

        // Qadam 2: Summa kiritildi
    if (await getMode(userId) === "owner_withdraw_amount") {
        if (text === "❌ Bekor qilish") {
            await setMode(userId, "sale");
            await redis.del(`owner_withdraw:${userId}`);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        }
        const rawNum  = text.replace(/[\s,]/g, "");
        const amount  = parseInt(rawNum);
        if (isNaN(amount) || amount <= 0) {
            return bot.sendMessage(chatId, "⚠️ To'g'ri summa kiriting (masalan: 50000)");
        }
        await redis.set(`owner_withdraw:${userId}`, JSON.stringify({ amount }), "EX", 600);
        await setMode(userId, "owner_withdraw_desc");
        return bot.sendMessage(chatId,
            `✅ Summa: <b>${formatMoney(amount)} so'm</b>\n\n` +
            "📝 <b>Tavsif yozing</b> (nima uchun?):\n" +
            "<i>Masalan: Oziq-ovqat, Uy xarajati, Bozor...</i>",
            {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: [
                        [{ text: "Oziq-ovqat" }, { text: "Uy xarajati" }],
                        [{ text: "Bozor" }, { text: "Kiyim-kechak" }],
                        [{ text: "Yoqilg'i" }, { text: "Boshqa" }],
                        [{ text: "⏭ O'tkazib yuborish" }, { text: "❌ Bekor qilish" }],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                }
            }
        );
    }

    // Qadam 3: Tavsif → Saqlash
    if (await getMode(userId) === "owner_withdraw_desc") {
        if (text === "❌ Bekor qilish") {
            await setMode(userId, "sale");
            await redis.del(`owner_withdraw:${userId}`);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        }

        const stateRaw = await redis.get(`owner_withdraw:${userId}`);
        const state    = stateRaw ? JSON.parse(stateRaw) : {};
        const amount   = state.amount || 0;
        const desc     = text === "⏭ O'tkazib yuborish" ? "" : text.trim();
        const spender  = { tgId: userId, tgName: msg.from?.first_name || "Admin" };
        const title    = desc ? `Dukon foidasidan: ${desc}` : "Dukon foidasidan";

        // Expenseга saqlash
        const { saveExpenseWithTx } = require("../logic/storage");
        const exp = await saveExpenseWithTx({
            spender,
            title,
            amount,
            categoryKey: "owner_withdraw",
            description: desc,
        });

        // Guruhga xabar
        const notifyText =
            `💼 <b>DUKON FOIDASIDAN</b>

` +
            `👤 Kim: <b>${spender.tgName}</b>
` +
            `💰 Summa: <b>${formatMoney(amount)} so'm</b>
` +
            (desc ? `📝 Sabab: <b>${desc}</b>
` : "") +
            `🆔 <code>${exp?.orderNo || ""}</code>`;

        await sendToGroup(bot, notifyText);

        // Xodimga tasdiq
        await bot.sendMessage(chatId,
            `✅ <b>Saqlandi!</b>
` +
            `💼 Dukon foidasidan: <b>${formatMoney(amount)} so'm</b>
` +
            (desc ? `📝 <i>${desc}</i>
` : "") +
            `
📊 Oylik hisobotda ko'rinadi.`,
            { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
        );

        await redis.del(`owner_withdraw:${userId}`);
        await setMode(userId, "sale");
        return;
    }
    if (text === "📦 Kirim (Taminot)")   return startPurchase(bot, chatId, userId);

    if (text === "📌 Qarzlar") {
        const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(20).lean();
        if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo'q.");
        // ✅ Avval sarlavha, keyin parallel yuborish (N+1 o'rniga Promise.all)
        await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
        await Promise.all(
            debts.map(d => bot.sendMessage(chatId, formatDebtCard(d), { parse_mode: "HTML", ...debtPayButton(d._id) }))
        );
        return;
    }
    if (text === "📆 Oylik hisobot") {
        const year = dayjs().year();
        return bot.sendMessage(chatId, `📆 Oy tanlang (${year}):`, { reply_markup: monthKeyboard(year) });
    }
    // ══════════════════════════════════════════════════════
    // 🔒 KASSA YOPISH — ko'p qadamli flow
    // Qadam 1: Nechta tort qoldi?
    // Qadam 2: Vitrina rasmini oling (1-rasm)
    // Qadam 3: Vitrina rasmini oling (2-rasm) | O'tkazib yuborish
    // Qadam 4: Hisobot yuboriladi
    // ══════════════════════════════════════════════════════
    if (text === "🔒 Kasani yopish") {
        await setMode(userId, "close_cash_tort");
        await redis.del(`close_cash:${userId}`);
        return bot.sendMessage(chatId,
            "🔒 <b>Kassa yopish boshlandi</b>\n\n" +
            "🎂 <b>Bugun nechta tort qoldi?</b>\n" +
            "<i>Raqam yozing (masalan: 3, 6, 9...)</i>",
            {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: [
                        [{ text: "0" }, { text: "1" }, { text: "2" }, { text: "3" }],
                        [{ text: "4" }, { text: "5" }, { text: "6" }, { text: "7" }],
                        [{ text: "8" }, { text: "9" }, { text: "10" }, { text: "12" }],
                        [{ text: "❌ Bekor qilish" }],
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true,
                }
            }
        );
    }

    // Qadam 2: Tort soni kiritildi
    if (await getMode(userId) === "close_cash_tort") {
        if (text === "❌ Bekor qilish") {
            await setMode(userId, "sale");
            await redis.del(`close_cash:${userId}`);
            return bot.sendMessage(chatId, "❌ Kassa yopish bekor qilindi.", {
                reply_markup: mainMenuKeyboard(),
            });
        }
        const tortCount = parseInt(text);
        if (isNaN(tortCount) || tortCount < 0) {
            return bot.sendMessage(chatId, "⚠️ Raqam kiriting (masalan: 0, 3, 6...)");
        }
        await redis.set(`close_cash:${userId}`, JSON.stringify({ tortCount }), "EX", 600);
        await setMode(userId, "close_cash_photo1");
        return bot.sendMessage(chatId,
            `✅ <b>${tortCount} ta tort</b> qoldi.\n\n` +
            "📸 <b>1-vitrina (muzlatgich) rasmini oling</b>\n" +
            "<i>Tortlar aniq ko'rinishi shart!</i>",
            {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: [[{ text: "⏭ O'tkazib yuborish" }], [{ text: "❌ Bekor qilish" }]],
                    resize_keyboard: true,
                }
            }
        );
    }

    // Qadam 3: 1-rasm yoki o'tkazib yuborish
    if (await getMode(userId) === "close_cash_photo1") {
        if (text === "❌ Bekor qilish") {
            await setMode(userId, "sale");
            await redis.del(`close_cash:${userId}`);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        }

        const stateRaw  = await redis.get(`close_cash:${userId}`);
        const state     = stateRaw ? JSON.parse(stateRaw) : {};

        // Rasm YOKI yumaloq video qabul qilamiz
        if (msg.photo || msg.video_note) {
            state.media1 = msg.photo
                ? { type: "photo",      fileId: msg.photo[msg.photo.length - 1].file_id }
                : { type: "video_note", fileId: msg.video_note.file_id };
            await redis.set(`close_cash:${userId}`, JSON.stringify(state), "EX", 600);
            await setMode(userId, "close_cash_photo2");
            const label = msg.photo ? "✅ 1-rasm" : "✅ 1-video";
            return bot.sendMessage(chatId,
                `${label} qabul qilindi.\n\n` +
                "📸 <b>2-vitrina: rasm yoki yumaloq video oling</b>\n" +
                "<i>Yoki o'tkazib yuboring</i>",
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [[{ text: "⏭ O'tkazib yuborish" }], [{ text: "❌ Bekor qilish" }]],
                        resize_keyboard: true,
                    }
                }
            );
        }
        if (text === "⏭ O'tkazib yuborish") {
            await setMode(userId, "close_cash_photo2");
            return bot.sendMessage(chatId,
                "📸 <b>2-vitrina: rasm yoki yumaloq video oling</b>\n<i>Yoki o'tkazib yuboring</i>",
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [[{ text: "⏭ O'tkazib yuborish" }], [{ text: "❌ Bekor qilish" }]],
                        resize_keyboard: true,
                    }
                }
            );
        }
        return bot.sendMessage(chatId, "📸 Rasm yoki 🎥 yumaloq video yuboring (yoki o'tkazib yuboring).");
    }

    // Qadam 4: 2-media yoki o'tkazib yuborish → Hisobot
    if (await getMode(userId) === "close_cash_photo2") {
        if (text === "❌ Bekor qilish") {
            await setMode(userId, "sale");
            await redis.del(`close_cash:${userId}`);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenuKeyboard() });
        }

        const stateRaw = await redis.get(`close_cash:${userId}`);
        const state    = stateRaw ? JSON.parse(stateRaw) : {};

        // 2-media qabul qilish
        if (msg.photo || msg.video_note) {
            state.media2 = msg.photo
                ? { type: "photo",      fileId: msg.photo[msg.photo.length - 1].file_id }
                : { type: "video_note", fileId: msg.video_note.file_id };
        }

        // Media ro'yxatini yig'amiz
        const mediaList = [state.media1, state.media2].filter(Boolean);

        // ⏳ Yuklanmoqda
        await bot.sendMessage(chatId,
            "⏳ Hisobot tayyorlanmoqda...",
            { reply_markup: { remove_keyboard: true } }
        ).catch(() => null);

        // DB dan hisobot
        const summary = await closeCashAndMakeReport();

        // Guruhga: rasm/video + hisobot
        await sendCloseReportToGroup(bot, {
            summary,
            tortCount: state.tortCount,
            media: mediaList,
        });

        // Xodimga: matn + fayl
        const reportText = buildCloseReportText({ ...summary, tortCount: state.tortCount });
        await bot.sendMessage(chatId, reportText, { parse_mode: "HTML" }).catch(() => {});
        await bot.sendDocument(chatId, summary.filePath, {}, { filename: summary.fileName }).catch(() => {});

        // Tozalash
        await redis.del(`close_cash:${userId}`);
        await setMode(userId, "sale");

        await bot.sendMessage(chatId, "✅ Kassa yopildi! Yaxshi dam oling 🌙", {
            reply_markup: mainMenuKeyboard(),
        });
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
    // ── ADMIN: Pin xabar qo'lda yuborish
    if (text === "📌 Pin xabar yuborish") {
        if (!admin) return bot.sendMessage(chatId, "⛔ Ruxsat yo'q.");
        await bot.sendMessage(chatId, "⏳ Pin xabar yangilanmoqda...");
        try {
            await ensurePinnedMiniAppLinkInGroup(bot);
            return bot.sendMessage(chatId, "✅ Pin xabar guruhga yuborildi va pin qilindi!");
        } catch (e) {
            return bot.sendMessage(chatId, "❌ Xatolik: " + (e?.message || e));
        }
    }

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
        const workers = await Worker.find().sort({ createdAt: -1 }).lean();
        if (!workers.length) return bot.sendMessage(chatId, "Foydalanuvchilar topilmadi");
        // ✅ Parallel yuborish — ketma-ket await o'rniga Promise.all
        await Promise.all(workers.map(w => {
            const status     = w.isActive ? "🟢 Aktiv" : "🔴 Nofaol";
            const adminBadge = Number(w.tgId) === Number(ADMIN_TG_ID) ? " 👑" : "";
            return bot.sendMessage(
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
        }));
        return;
    }

    // ── Default: sotuv rejimi
    const seller = { tgId: userId, tgName: getUserName(msg) };
    return processSaleInput(bot, msg, text, seller, { tryAI: false });
}

module.exports = { onMessage };
