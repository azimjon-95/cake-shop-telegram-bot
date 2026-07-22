// src/services/closeCash.js
// Kassa yopish: hisobot + tort qoldiq + vitrina rasmlari

const fs   = require("fs");
const path = require("path");

const Sale    = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt    = require("../models/Debt");
const Counter = require("../models/Counter");

const { triggerBackupOnClose } = require("./backupScheduler");
const { formatMoney }          = require("../utils/money");
const { startOfToday, formatHM, formatMonthYear } = require("../utils/time");
const { GROUP_CHAT_ID }        = require("../config");

// ── Hisobot matni ──────────────────────────────────────
function buildCloseReportText({ saleSum, expenseSum, debtSum, balance, from, to, tortCount }) {
    const pad = "─".repeat(30);
    let msg = `🔒 <b>KASSA YOPILDI</b>\n`;
    
    // ✅ Eng ishonchli bugungi sana
    msg += `📅 ${formatMonthYear()}\n`;           // dayjs ichida TZ bor
    msg += `⏰ ${formatHM(from)} → ${formatHM(to)}\n`;
    msg += `${pad}\n\n`;

    msg += `💰 <b>Sotuv (tushgan):</b> ${formatMoney(saleSum)} so'm\n`;
    msg += `💸 <b>Chiqim:</b> ${formatMoney(expenseSum)} so'm\n`;
    msg += `📊 <b>Sof foyda:</b> ${formatMoney(Math.max(0, saleSum - expenseSum))} so'm\n`;
    msg += `📌 <b>Qarzlar:</b> ${formatMoney(debtSum)} so'm\n`;
    msg += `🏦 <b>Kassa:</b> ${formatMoney(balance)} so'm\n`;
    
    if (tortCount !== null && tortCount !== undefined) {
        msg += `\n${pad}\n`;
        msg += `🎂 <b>Qolgan tort:</b> ${tortCount} ta\n`;
    }
    msg += `\n${pad}\n`;
    msg += `✅ Kun yakunlandi`;
    return msg;
}

// ── TXT hisobot fayli ──────────────────────────────────
async function buildReportFile({ sales, expenses, debtsOpen, saleSum, expenseSum, debtSum, balance, from, to }) {
    const lines = [];
    lines.push(`KUNLIK HISOBOT (${formatMonthYear(new Date())})`);
    lines.push(`Vaqt: ${formatHM(from)} → ${formatHM(to)}`);
    lines.push("");
    lines.push(`Sotuv: ${formatMoney(saleSum)} so'm`);
    lines.push(`Chiqim: ${formatMoney(expenseSum)} so'm`);
    lines.push(`Sof: ${formatMoney(Math.max(0, saleSum - expenseSum))} so'm`);
    lines.push(`Qarzlar: ${formatMoney(debtSum)} so'm`);
    lines.push(`Kassa: ${formatMoney(balance)} so'm`);
    lines.push("");
    lines.push("═".repeat(40));
    lines.push("SOTUVLAR");
    lines.push("═".repeat(40));
    for (const s of sales) {
        lines.push(
            `${formatHM(s.createdAt)} | ${s.seller?.tgName || "?"} | ` +
            `${formatMoney(s.paidTotal)} so'm | ` +
            (s.items || []).map(i => `${i.name} x${i.qty}(${formatMoney(i.price)})`).join(", ")
        );
    }
    lines.push("");
    lines.push("═".repeat(40));
    lines.push("CHIQIMLAR");
    lines.push("═".repeat(40));
    for (const e of expenses) {
        lines.push(`${formatHM(e.createdAt)} | ${e.spender?.tgName || "?"} | ${e.title} | -${formatMoney(e.amount)} so'm`);
    }
    lines.push("");
    lines.push("═".repeat(40));
    lines.push("OCHIQ QARZLAR");
    lines.push("═".repeat(40));
    for (const d of debtsOpen) {
        lines.push(
            `${formatHM(d.createdAt)} | ${d.seller?.tgName || "?"} | ` +
            `${d.note || ""} | Tel: ${d.customerPhone || "-"} | ` +
            `Qolgan: ${formatMoney(d.remainingDebt)} so'm`
        );
    }

    const reportDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const fileName = `hisobot_${new Date().toISOString().slice(0, 10)}.txt`;
    const filePath = path.join(reportDir, fileName);
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    return { filePath, fileName };
}

// ── Asosiy: hisobot ma'lumotlarini yig'ish ─────────────
async function closeCashAndMakeReport() {
    const from = startOfToday();
    const to   = new Date();

    const [sales, expenses, debtsOpen, balance] = await Promise.all([
        Sale.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }).lean(),
        Expense.find({ createdAt: { $gte: from, $lte: to } }).sort({ createdAt: 1 }).lean(),
        Debt.find({ isClosed: false, kind: "customer" }).sort({ createdAt: -1 }).limit(200).lean(),
        Counter.findOne({ key: "balance" }).lean(),
    ]);

    const saleSum    = sales.reduce((a, s) => a + (s.paidTotal || 0), 0);
    const expenseSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const debtSum    = debtsOpen.reduce((a, d) => a + (d.remainingDebt || 0), 0);
    const bal        = balance?.value || 0;

    const { filePath, fileName } = await buildReportFile({
        sales, expenses, debtsOpen, saleSum, expenseSum, debtSum,
        balance: bal, from, to,
    });

    triggerBackupOnClose().catch(() => {});

    return { saleSum, expenseSum, debtSum, balance: bal, from, to, filePath, fileName };
}

// ── Guruhga kassa yopildi + tort qoldiq + rasm/video ───
// media: [ { type: "photo"|"video_note", fileId } ]
async function sendCloseReportToGroup(bot, {
    summary,
    tortCount,
    media = [],   // [ { type: "photo"|"video_note", fileId } ] max 2
}) {
    if (!GROUP_CHAT_ID) return;

    const msgText = buildCloseReportText({ ...summary, tortCount });

    // Video note va photo larni ajratamiz
    const photos     = media.filter(m => m.type === "photo");
    const videoNotes = media.filter(m => m.type === "video_note");

    // 1. Rasmlar bo'lsa — media group (caption birinchisida)
    if (photos.length > 0) {
        try {
            const mediaGroup = photos.slice(0, 2).map((m, i) => ({
                type:       "photo",
                media:      m.fileId,
                caption:    i === 0 ? msgText : undefined,
                parse_mode: i === 0 ? "HTML"  : undefined,
            }));
            await bot.sendMediaGroup(GROUP_CHAT_ID, mediaGroup);
        } catch (e) {
            console.error("[closeCash] sendMediaGroup:", e?.message);
            await bot.sendMessage(GROUP_CHAT_ID, msgText, { parse_mode: "HTML" }).catch(() => {});
        }
    } else {
        // Rasim yo'q — faqat matn
        await bot.sendMessage(GROUP_CHAT_ID, msgText, { parse_mode: "HTML" }).catch(() => {});
    }

    // 2. Video note lar alohida yuboriladi (caption qo'yib bo'lmaydi)
    for (const v of videoNotes.slice(0, 2)) {
        await bot.sendVideoNote(GROUP_CHAT_ID, v.fileId).catch(e => {
            console.error("[closeCash] sendVideoNote:", e?.message);
        });
    }
}

module.exports = { closeCashAndMakeReport, sendCloseReportToGroup, buildCloseReportText };
