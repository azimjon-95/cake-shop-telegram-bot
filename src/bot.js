const TelegramBot = require("node-telegram-bot-api");
const { BOT_TOKEN } = require("./config");
const dayjs = require("dayjs");
const { mainMenuKeyboard, startKeyboard, monthKeyboard } = require("./keyboards");
const { isAuthed, setAuthed, clearAuthed, setMode, getMode, checkPassword, redis } = require("./services/auth");
const { makeMonthlyReport } = require("./services/monthlyReport");
const Sale = require("./models/Sale");
const Expense = require("./models/Expense");
const Debt = require("./models/Debt");
const Counter = require("./models/Counter");
const { mongoose } = require("./db");

const { parseSaleMessage } = require("./utils/parseSale");
const { parseExpenseMessage } = require("./utils/parseExpense");
const { formatMoney } = require("./utils/money");
const { sendToGroup } = require("./services/notify");
const { saleNotifyText, expenseNotifyText, closeNotifyText, debtPayNotifyText } = require("./utils/report");
const { payDebt } = require("./services/debtPay");
const { closeCashAndMakeReport } = require("./services/closeCash");

function getUserName(msg) {
    const u = msg.from || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    return name || u.username || String(u.id);
}

async function ensureBalance(session) {
    const doc = await Counter.findOne({ key: "balance" }).session(session || null);
    if (doc) return doc;
    const created = await Counter.create([{ key: "balance", value: 0 }], session ? { session } : undefined);
    return created[0];
}
async function addBalance(amount, session) {
    const bal = await ensureBalance(session);
    bal.value += amount;
    await bal.save({ session });
    return bal.value;
}

function itemsToText(items) {
    return items.map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`).join(", ");
}

async function saveSaleWithTx({ seller, items, phone }) {
    const session = await mongoose.startSession();

    const calc = () => {
        let total = 0;
        let paidTotal = 0;

        for (const it of items) {
            const itemTotal = it.qty * it.price;
            total += itemTotal;

            if (it.paid != null) {
                paidTotal += Math.min(it.paid, itemTotal);
            } else {
                paidTotal += itemTotal;
            }
        }

        const debtTotal = Math.max(0, total - paidTotal);
        return { total, paidTotal, debtTotal };
    };

    const run = async () => {
        const { total, paidTotal, debtTotal } = calc();

        const sale = (await Sale.create(
            [{
                seller,
                phone: phone || null,
                items,
                total,
                paidTotal,
                debtTotal
            }],
            session ? { session } : undefined
        ))[0];

        // kassaga real tushgan pul qo‘shiladi
        await addBalance(paidTotal, session);

        let debtDoc = null;
        if (debtTotal > 0) {
            const note = itemsToText(items);
            debtDoc = (await Debt.create(
                [{
                    saleId: sale._id,
                    customerPhone: phone || null,
                    totalDebt: debtTotal,
                    remainingDebt: debtTotal,
                    seller,
                    note,
                    isClosed: false,
                    payments: []
                }],
                session ? { session } : undefined
            ))[0];
        }

        return { sale, debtDoc };
    };

    try {
        let out;
        await session.withTransaction(async () => {
            out = await run();
        });
        return out;
    } catch (e) {
        // fallback: transaction bo‘lmasa ham ishlasin
        session.endSession();
        // oddiy (txsiz) saqlash
        const { total, paidTotal, debtTotal } = (() => {
            let total = 0, paidTotal = 0;
            for (const it of items) {
                const itemTotal = it.qty * it.price;
                total += itemTotal;
                paidTotal += (it.paid != null) ? Math.min(it.paid, itemTotal) : itemTotal;
            }
            return { total, paidTotal, debtTotal: Math.max(0, total - paidTotal) };
        })();

        const sale = await Sale.create({
            seller,
            phone: phone || null,
            items,
            total,
            paidTotal,
            debtTotal
        });
        await addBalance(paidTotal, null);

        let debtDoc = null;
        if (debtTotal > 0) {
            debtDoc = await Debt.create({
                saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal,
                remainingDebt: debtTotal,
                seller,
                note: itemsToText(items),
                isClosed: false,
                payments: []
            });
        }
        return { sale, debtDoc };
    } finally {
        try { session.endSession(); } catch { }
    }
}

async function saveExpenseWithTx({ spender, title, amount }) {
    const session = await mongoose.startSession();

    const run = async () => {
        const exp = (await Expense.create(
            [{
                spender,
                title,
                amount
            }],
            session ? { session } : undefined
        ))[0];

        // kassadan ayiramiz
        await addBalance(-amount, session);
        return exp;
    };

    try {
        let out;
        await session.withTransaction(async () => {
            out = await run();
        });
        return out;
    } catch (e) {
        session.endSession();
        const exp = await Expense.create({ spender, title, amount });
        await addBalance(-amount, null);
        return exp;
    } finally {
        try { session.endSession(); } catch { }
    }
}

function helpText() {
    return (
        `ℹ️ <b>BOTNI QANDAY ISHLATISH (QO‘LLANMA)</b>

<b>1) Kirish</b>
- Botga <b>/start</b> yozing
- Agar avval kirgan bo‘lsangiz: <b>menyu avtomatik chiqadi</b>
- Aks holda bot: <b>parolni kiriting</b> deydi
- Parol <b>2 kun</b> eslab qoladi (2 kundan keyin yana parol so‘raydi)

<b>2) Menyu tugmalari</b>
🧁 <b>Sotish</b>  — savdo kiritish (qarz ham bo‘lishi mumkin)  
💸 <b>Chiqim</b>  — xarajat kiritish  
📌 <b>Qarzlar</b> — ochiq qarzlarni ko‘rish va to‘lash  
🔒 <b>Kasani yopish</b> — bugungi hisobot + TXT fayl  
📆 <b>Oylik hisobot</b> — oy bo‘yicha hisobot + TXT fayl  
ℹ️ <b>Yordam</b> — shu qo‘llanma

━━━━━━━━━━━━━━━━━━━━

<b>3) 🧁 SOTISH (savdo kiritish)</b>

<b>Oddiy savdo:</b>
- Tort 140000
(1 dona Tort, narx = 140000, to‘liq to‘langan deb olinadi)

<b>Miqdor bilan savdo (qty):</b>
- Perog 2ta 12000
- Kofe 3 ta 8000
- Hot-dog 4x 10000
(Qoidalar: <b>2ta / 2 ta / 2 dona / 2x</b> — barchasi qty deb olinadi)

<b>Qarzli savdo (to‘langan summa ham yoziladi):</b>
- Tort 140000 100000
(bu: narx 140000, to‘landi 100000 → qarz 40000)

<b>Telefon qo‘shish (faqat "tel" yoki "telefon" bilan):</b>
- Tort 140000 100000 tel 903456677
Telefon bo‘lsa qarz kartasida ko‘rinadi va ustiga bosilsa qo‘ng‘iroq qiladi.

<b>Bir xabarda bir nechta mahsulot:</b>
✅ Eng ishonchli usul: <b>vergul bilan</b>
- Tort 140000 100000, Perog 2ta 12000, Hot-dog 3ta 10000 tel 903456677

✅ Vergulsiz ham ishlaydi (lekin mahsulotlarning har birida narx bo‘lishi shart):
- Tort 140000 100000 Perog 2ta 12000 Hot-dog 3ta 10000 tel 903456677

<b>Sotuv qoidalari (muhim):</b>
- <b>1-raqam</b> — narx
- <b>2-raqam</b> bo‘lsa — to‘langan summa (kam bo‘lsa qarz)
- qty (“2ta”) pul hisobiga kirmaydi
- tel ixtiyoriy, faqat <b>tel 9-xonali</b> ko‘rinishida yozing

━━━━━━━━━━━━━━━━━━━━

<b>4) 💸 CHIQIM (xarajat kiritish)</b>

<b>Oddiy chiqim:</b>
- Svetga 100000
- Arenda 1000000
- Taksiga 20000

<b>Miqdor bilan chiqim (qty × narx):</b>
- Mayanez 3ta 23000
(bu: 3 × 23000 = 69000 chiqim)

<b>Chiqim qoidalari:</b>
- Oxirgi summa narx hisoblanadi
- “1ta / 2ta / 3 ta” qty bo‘lib, summa bilan ko‘paytiriladi

━━━━━━━━━━━━━━━━━━━━

<b>5) 📌 QARZLAR (qarzni ko‘rish va to‘lash)</b>
- “📌 Qarzlar” bosilganda har bir qarz alohida chiqadi:
  - qachon qarz bo‘lgani
  - telefon (bo‘lsa bosib qo‘ng‘iroq qilsa bo‘ladi)
  - izoh (qaysi mahsulotlar)
  - qolgan qarz
- Har bir qarz tagida <b>💳 To‘lash</b> tugmasi bor

<b>To‘lash tartibi:</b>
- <b>To‘liq to‘lash</b> → qarz 0 bo‘ladi
- <b>Qisman to‘lash</b> → qancha to‘laysiz deb so‘raydi
  - Masalan: qarz 40000 bo‘lsa 30000 to‘lasangiz → qolgan 10000 bo‘ladi
- Qarz to‘langanida bot <b>gruppaga ham</b> “qarz to‘landi” deb xabar yuboradi

━━━━━━━━━━━━━━━━━━━━

<b>6) 🔒 KASANI YOPISH (kunlik hisobot)</b>
- Bugun (00:00 dan hozirgacha) bo‘yicha:
  - sotuvdan tushgan pul
  - chiqimlar
  - ochiq qarzlar jami
  - kassa balansi
- Pastidan <b>TXT fayl</b> yuboradi:
  - sotuvlar ro‘yxati
  - chiqimlar ro‘yxati
  - ochiq qarzlar ro‘yxati
- Hisobot botga ham, <b>gruppaga ham</b> yuboriladi

━━━━━━━━━━━━━━━━━━━━

<b>7) 📆 OYLIK HISOBOT</b>
- “📆 Oylik hisobot” bosiladi
- 12 ta oy chiqadi (Yanvar…Dekabr)
- Oyni tanlasangiz:
  - o‘sha oy sotuv tushumi
  - o‘sha oy chiqim
  - o‘sha oyda yaratilgan ochiq qarzlar (qolgan)
  - kassa balansi
- Pastidan <b>TXT fayl</b> yuboradi:
  - har kuni (cheslo) bo‘yicha sotuv/chiqim yig‘indisi
  - barcha sotuvlar / chiqimlar / qarzlar batafsil

━━━━━━━━━━━━━━━━━━━━

<b>✅ TEZ-TEZ ISHLATILADIGAN NAMUNALAR</b>
<b>Sotish:</b>
- Tort 140000
- Tort 140000 100000 tel 903456677
- Tort 140000 100000, Perog 2ta 12000, Hot-dog 3ta 10000

<b>Chiqim:</b>
- Svetga 100000
- Mayanez 3ta 23000
`
    );
}



function formatDebtCard(d) {
    const when = dayjs(d.createdAt).format("DD-MMM HH:mm");

    let phoneLine = "";
    if (d.customerPhone) {
        let p = String(d.customerPhone).replace(/[^\d]/g, "");
        if (p.length === 9) p = "998" + p;

        phoneLine = `📞 <b>Tel:</b> <a href="tel:+${p}">+${p}</a>\n`;
    }

    const note = d.note ? escapeHtml(d.note) : "-";

    return (
        `📌 <b>Qarz</b>\n` +
        `🕒 <b>Qachon:</b> ${when}\n` +
        phoneLine +
        `🧾 <b>Izoh:</b> ${note}\n` +
        `💰 <b>Qolgan:</b> ${formatMoney(d.remainingDebt)} so'm`
    );
}


function debtPayButton(debtId) {
    return {
        reply_markup: {
            inline_keyboard: [[{ text: "💳 To'lash", callback_data: `pay:${debtId}` }]]
        }
    };
}


function payAmountKeyboard(debtId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: "To'liq to'lash", callback_data: `payfull:${debtId}` }],
                [{ text: "Qisman to'lash", callback_data: `paypart:${debtId}` }]
            ]
        }
    };
}

function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function createBot() {
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN yo'q");
    const bot = new TelegramBot(BOT_TOKEN, { polling: true });

    bot.onText(/\/start/i, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        if (!userId) return;

        const ok = await isAuthed(userId);
        if (ok) {
            await setMode(userId, "menu");
            // 👇 MENYU SHU YERDA
            return bot.sendMessage(
                chatId,
                "Menyu:",
                { reply_markup: mainMenuKeyboard() }
            );
        }

        await setMode(userId, "await_password");
        return bot.sendMessage(chatId, "🔑 Parolni kiriting:");
    });




    // Callback (qarz to'lash)
    bot.on("callback_query", async (q) => {
        const msg = q.message;
        const chatId = msg.chat.id;
        const from = q.from;

        const seller = { tgId: from.id, tgName: getUserName({ from }) };

        try {
            const data = q.data || "";

            if (data.startsWith("pay:")) {
                const debtId = data.split(":")[1];
                const debt = await Debt.findById(debtId);
                if (!debt) return bot.answerCallbackQuery(q.id, { text: "Qarz topilmadi" });

                await bot.sendMessage(
                    chatId,
                    `📌 Qarz: <b>${escapeHtml(debt.note)}</b>\nQolgan: <b>${formatMoney(debt.remainingDebt)}</b> so'm\nQanday to'laysiz?`,
                    { parse_mode: "HTML", ...payAmountKeyboard(debtId) }
                );
                return bot.answerCallbackQuery(q.id);
            }

            if (data.startsWith("payfull:")) {
                const debtId = data.split(":")[1];
                const debt = await Debt.findById(debtId);
                if (!debt) return bot.answerCallbackQuery(q.id, { text: "Qarz topilmadi" });

                const { debt: updated, actualPay } = await payDebt({
                    debtId,
                    amount: debt.remainingDebt,
                    payer: seller
                });
                const notify = debtPayNotifyText({
                    payerName: seller.tgName,
                    note: escapeHtml(debt.note || "-"),
                    phone: debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null,
                    paid: formatMoney(actualPay),
                    remaining: formatMoney(updated.remainingDebt)
                });

                await bot.sendMessage(
                    chatId,
                    `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
                    { parse_mode: "HTML" }
                );
                await sendToGroup(bot, notify);
                return bot.answerCallbackQuery(q.id);
            }

            if (data.startsWith("paypart:")) {
                const debtId = data.split(":")[1];
                await redis.set(`await_pay_amount:${from.id}`, debtId, "EX", 300);
                await bot.sendMessage(chatId, "✍️ Qancha to'laysiz? (faqat summa yozing, masalan: 30000)");
                return bot.answerCallbackQuery(q.id);
            }

            // ===== OYLIK HISOBOT (INLINE CALLBACK) =====
            if (data.startsWith("rep_month:")) {
                const [, y, m] = data.split(":");
                const year = parseInt(y, 10);
                const monthIndex = parseInt(m, 10);

                await bot.answerCallbackQuery(q.id);

                const rep = await makeMonthlyReport(year, monthIndex);

                const textMsg =
                    `📆 <b>Oylik hisobot: ${rep.monthTitle}</b>\n\n` +
                    `💰 Sotuvdan tushgan: <b>${formatMoney(rep.saleSum)}</b> so'm\n` +
                    `💸 Chiqimlar: <b>${formatMoney(rep.expenseSum)}</b> so'm\n` +
                    `📌 Ochiq qarz (qolgan): <b>${formatMoney(rep.debtSum)}</b> so'm\n` +
                    `🏦 Kassa balansi: <b>${formatMoney(rep.balance)}</b> so'm`;

                await bot.sendMessage(chatId, textMsg, { parse_mode: "HTML" });

                // TXT fayl yuborish (botga)
                await bot.sendDocument(chatId, rep.filePath, {
                    caption: `📄 Batafsil oylik hisobot: ${rep.fileName}`
                });

                // Agar xohlasangiz – gruppaga ham yuboradi
                const { GROUP_CHAT_ID } = require("./config");
                if (GROUP_CHAT_ID) {
                    await bot.sendDocument(GROUP_CHAT_ID, rep.filePath, {
                        caption: `📄 Oylik hisobot (${rep.monthTitle})`
                    });
                }

                return;
            }

        } catch (e) {
            await bot.sendMessage(chatId, `⚠️ Xatolik: ${e.message}`);
            try { await bot.answerCallbackQuery(q.id); } catch { }
        }
    });

    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text = String(msg.text || "").trim();
        if (!userId || !text) return;

        // /start handlerga kirmagan boshqa msglar
        if (text.startsWith("/")) return;

        // Start tugmasi
        if (text === "▶️ Start") {
            const ok = await isAuthed(userId);
            if (ok) return bot.sendMessage(chatId, "✅ Siz allaqachon kirdingiz.", mainMenuKeyboard());
            await bot.sendMessage(chatId, "🔑 Parolni kiriting:");
            await setMode(userId, "await_password");
            return;
        }

        const mode = await getMode(userId);

        // Parol kutyapmizkutyapmiz
        if (mode === "await_password") {
            if (checkPassword(text)) {
                await setAuthed(userId);
                await setMode(userId, "menu");

                // 👇 MENYU SHU YERDA
                return bot.sendMessage(
                    chatId,
                    "Menyu:",
                    { reply_markup: mainMenuKeyboard() }
                );
            }

            return bot.sendMessage(chatId, "❌ Noto‘g‘ri parol. Qayta kiriting:");
        }

        // Auth tekshir
        const ok = await isAuthed(userId);
        if (!ok) {
            // parol yo‘q bo‘lsa startga qaytaramiz
            return bot.sendMessage(chatId, "🔒 Avval /start bosing va parol kiriting.", startKeyboard());
        }

        // Qarzni qisman to‘lash uchun summa kutish
        const awaitingDebtId = await redis.get(`await_pay_amount:${userId}`);
        if (awaitingDebtId) {
            const amount = parseInt(text.replace(/[^\d]/g, ""), 10) || 0;
            if (!amount) return bot.sendMessage(chatId, "❌ Summa noto‘g‘ri. Masalan: 30000");

            const payer = { tgId: userId, tgName: getUserName(msg) };

            try {
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

                // ✅ Telni normallashtiramiz: 9 xonali bo‘lsa 998 qo‘shamiz
                let phone = debt.customerPhone ? String(debt.customerPhone).replace(/[^\d]/g, "") : null;
                if (phone && phone.length === 9) phone = "998" + phone;

                const notify = debtPayNotifyText({
                    payerName: payer.tgName,
                    note: debt.note || "-", // ✅ escape'ni debtPayNotifyText ichida qiling
                    phone,
                    paid: actualPay,
                    remaining: updated.remainingDebt
                });

                await bot.sendMessage(
                    chatId,
                    `✅ To'landi: <b>${formatMoney(actualPay)}</b> so'm\nQolgan: <b>${formatMoney(updated.remainingDebt)}</b> so'm`,
                    { parse_mode: "HTML" }
                );

                await sendToGroup(bot, notify);
            } catch (e) {
                await bot.sendMessage(chatId, `⚠️ Xatolik: ${e.message}`);
            }

            return;
        }


        // Menyu tugmalari
        if (text === "🧁 Sotish") {
            await setMode(userId, "sale");
            return bot.sendMessage(chatId, "🧁 Sotish rejimi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000\nYoki: Tort 100000 80000 tel 903456677");
        }

        if (text === "💸 Chiqim") {
            await setMode(userId, "expense");
            return bot.sendMessage(chatId, "💸 Chiqim rejimi.\nMisol: Svetga 100000\nYoki: Arenda 1000000");
        }

        if (text === "📌 Qarzlar") {
            const debts = await Debt.find({ isClosed: false }).sort({ createdAt: -1 }).limit(50);

            if (debts.length === 0) {
                return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo‘q.");
            }

            await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);

            // Har bir qarzga alohida xabar + pastida "To'lash" tugmasi
            for (const d of debts) {
                await bot.sendMessage(
                    chatId,
                    formatDebtCard(d),
                    { parse_mode: "HTML", ...debtPayButton(d._id) }
                );
            }
            return;
        }


        // 📆 Oylik hisobot
        if (text === "📆 Oylik hisobot") {
            const year = dayjs().year(); // hozirgi yil
            return bot.sendMessage(
                chatId,
                `📆 Oylik hisobot.\nOyni tanlang (${year}):`,
                { reply_markup: monthKeyboard(year) }
            );
        }


        if (text === "🔒 Kasani yopish") {
            const summary = await closeCashAndMakeReport();

            const msgText = closeNotifyText(summary);
            await bot.sendMessage(chatId, msgText, { parse_mode: "HTML" });
            await sendToGroup(bot, msgText);

            // txt yuborish (botga ham, gruppaga ham)
            await bot.sendDocument(chatId, summary.filePath, {}, { filename: summary.fileName });
            const { GROUP_CHAT_ID } = require("./config");
            if (GROUP_CHAT_ID) {
                await bot.sendDocument(GROUP_CHAT_ID, summary.filePath, {}, { filename: summary.fileName });
            }
            return;
        }

        if (text === "ℹ️ Yordam") {
            return bot.sendMessage(chatId, helpText(), { parse_mode: "HTML" });
        }

        // Default: modega qarab yoki auto-detect
        const seller = { tgId: userId, tgName: getUserName(msg) };

        const currentMode = mode === "menu" || !mode ? null : mode;

        // Agar user Sotish bosmasa ham, matnda raqam bo‘lsa sotuv deb ko‘ramiz (senga kerak bo‘lgani)
        const hasMoney = /\d/.test(text);

        if (currentMode === "expense") {
            const exp = parseExpenseMessage(text);
            if (!exp) return bot.sendMessage(chatId, "❌ Chiqim topilmadi. Misol: Svetga 100000");

            const saved = await saveExpenseWithTx({
                spender: seller,
                title: exp.title,
                amount: exp.amount
            });

            const notify = expenseNotifyText({
                spenderName: seller.tgName,
                title: saved.title,
                amount: saved.amount
            });

            await bot.sendMessage(chatId, `✅ Chiqim saqlandi: -${formatMoney(saved.amount)} so'm`);
            await sendToGroup(bot, notify);
            return;
        }

        // sale mode yoki auto
        if (currentMode === "sale" || hasMoney) {
            const parsed = parseSaleMessage(text);
            if (!parsed.items.length) {
                return bot.sendMessage(chatId, "❌ Sotuv topilmadi.\nMisol: Tort 140000\nYoki: Perog 2ta 40000");
            }

            const { sale, debtDoc } = await saveSaleWithTx({
                seller,
                items: parsed.items,
                phone: parsed.phone
            });

            const itemsText = itemsToText(sale.items);
            const notify = saleNotifyText({
                sellerName: seller.tgName,
                itemsText,
                paidTotal: sale.paidTotal,
                debtTotal: sale.debtTotal,
                phone: sale.phone
            });

            await bot.sendMessage(
                chatId,
                `✅ Sotuv saqlandi.\nTushgan: ${formatMoney(sale.paidTotal)} so'm` +
                (sale.debtTotal > 0 ? `\nQarz: ${formatMoney(sale.debtTotal)} so'm` : "")
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

        // agar hech narsa tushunmasa
        return bot.sendMessage(chatId, "ℹ️ Menyu tugmalaridan birini tanlang yoki Yordam’ni bosing.", mainMenuKeyboard());
    });

    return bot;
}

module.exports = { createBot };
