// src/services/smartNotifier.js
// 5 ta savdo oshirish funksiyasi:
// 1. Navi bo'yicha aniq tort rejasi (Zubayda uchun)
// 2. Mijozlarga cashback eslatma
// 3. Qarz ogohlantirish (3 kundan oshsa)
// 4. Kam sotilgan kunlar ogohlantirish
// 5. Bayram oldidan mass xabar

const schedule  = require("node-schedule");
const Sale      = require("../models/Sale");
const Customer  = require("../models/Customer");
const Debt      = require("../models/Debt");
const { GROUP_CHAT_ID, BAKER_TG_ID, WEBAPP_URL } = require("../config");

function toMoney(n) { return Number(n||0).toLocaleString("uz-UZ"); }
function pad(v)     { return String(v).padStart(2,"0"); }

function tashkentNow() {
    const now  = new Date();
    const ms   = now.getTime() + 5*3600_000;
    return new Date(ms);
}

function startOfTashkentDay(offset = 0) {
    const t = tashkentNow();
    const y = t.getUTCFullYear();
    const m = pad(t.getUTCMonth()+1);
    const d = pad(t.getUTCDate() + offset);
    return new Date(`${y}-${m}-${d}T00:00:00.000+05:00`);
}

// ═══════════════════════════════════════════════════
// 1. NAVI BO'YICHA TORT REJASI — Zubayda uchun
// Har kuni 21:00 da — bugungi sotuvlarni tahlil qiladi
// va ertaga qaysi navdan nechta pishirish kerakligini aytadi
// ═══════════════════════════════════════════════════
async function sendDetailedBakerPlan(bot) {
    if (!BAKER_TG_ID) return;

    const from = startOfTashkentDay();
    const to   = new Date(from.getTime() + 86400_000);

    const sales = await Sale.find({ createdAt: { $gte: from, $lte: to } }).lean();

    // Navi bo'yicha hisoblash
    const navMap = {};
    let totalTort = 0;

    for (const sale of sales) {
        for (const it of (sale.items || [])) {
            const name  = String(it.name || "").trim();
            const qty   = Number(it.qty || 1);
            const price = Number(it.price || 0);

            // 60 000 dan yuqori = tort
            if (price >= 60_000 || /tort|bento/i.test(name)) {
                navMap[name] = (navMap[name] || 0) + qty;
                totalTort   += qty;
            }
        }
    }

    // Top 8 navi
    const sorted = Object.entries(navMap)
        .sort((a,b) => b[1]-a[1])
        .slice(0, 8);

    // Bayram tekshirish
    const hint = getUpcomingHoliday();
    const boost = hint ? hint.boost : 1.1;
    const planBase = Math.max(5, Math.round(totalTort * boost));

    let lines = `🍞 <b>ZUBAYDA — ERTANGI REJA</b>\n`;
    lines += `📅 ${pad(tashkentNow().getUTCDate()+1)}.${pad(tashkentNow().getUTCMonth()+1)} uchun\n`;
    lines += `──────────────────\n\n`;

    if (hint) {
        lines += `🎉 <b>${hint.name}</b> — ${hint.daysLeft} kun qoldi!\n`;
        lines += `📈 Savdo ×${hint.boost} oshadi\n\n`;
    }

    lines += `📊 Bugun sotildi: <b>${totalTort} ta tort</b>\n\n`;

    if (sorted.length > 0) {
        lines += `🎂 <b>Navi bo'yicha reja:</b>\n`;
        for (const [name, qty] of sorted) {
            const plan = Math.max(1, Math.round(qty * boost));
            lines += `  • ${name}: bugun <b>${qty}</b> ta → ertaga <b>${plan}</b> ta\n`;
        }
    } else {
        lines += `🎂 Kamida <b>${planBase} ta tort</b> tayyorlang\n`;
    }

    lines += `\n⏰ Ertalab <b>08:00</b> gacha tayyor bo'lsin`;

    await bot.sendMessage(BAKER_TG_ID, lines, { parse_mode: "HTML" }).catch(()=>{});
    console.log("[smartNotifier] Baker plan yuborildi");
}

// ═══════════════════════════════════════════════════
// 2. MIJOZLARGA CASHBACK ESLATMA
// Haftada bir marta (shanba 10:00) — bali bor lekin
// 14 kundan beri kelmagan mijozlarga xabar
// ═══════════════════════════════════════════════════
async function sendCashbackReminders(bot) {
    const cutoff = new Date(Date.now() - 14*86400_000);

    // Bali bor va uzoq vaqt kelmagan mijozlar
    const customers = await Customer.find({
        points: { $gte: 10000 },  // 10 000+ ball
        updatedAt: { $lte: cutoff }
    }).limit(100).lean();

    if (!customers.length) {
        console.log("[smartNotifier] Cashback eslatma: yuborish uchun mijoz yo'q");
        return;
    }

    let sent = 0;
    for (const c of customers) {
        try {
            await bot.sendMessage(
                c.tgId,
                `🎁 <b>Sizda ${toMoney(c.points)} so'm cashback ball bor!</b>\n\n` +
                `Tortni qo'llang va chegirma oling.\n` +
                `📍 Sang'sentir, Anhor minosi\n` +
                `📞 +998 77 737 77 40\n\n` +
                `Tez keling, xush kelibsiz! 🎂`,
                { parse_mode: "HTML" }
            );
            sent++;
            // Spam bo'lmasin — 300ms oraliq
            await new Promise(r => setTimeout(r, 300));
        } catch { /* foydalanuvchi botni bloklagan bo'lishi mumkin */ }
    }

    if (GROUP_CHAT_ID) {
        await bot.sendMessage(
            GROUP_CHAT_ID,
            `📲 Cashback eslatma: <b>${sent}</b> mijozga yuborildi (${customers.length} ta topildi)`,
            { parse_mode: "HTML" }
        ).catch(()=>{});
    }
    console.log(`[smartNotifier] Cashback eslatma: ${sent} ta yuborildi`);
}

// ═══════════════════════════════════════════════════
// 3. QARZ OGOHLANTIRISH
// Har kuni 09:00 da — 3 kundan oshgan qarzlar
// ═══════════════════════════════════════════════════
async function sendDebtAlerts(bot) {
    if (!GROUP_CHAT_ID) return;

    const threeDaysAgo = new Date(Date.now() - 3*86400_000);

    const oldDebts = await Debt.find({
        isClosed: false,
        kind: "customer",
        createdAt: { $lte: threeDaysAgo }
    }).sort({ remainingDebt: -1 }).limit(20).lean();

    if (!oldDebts.length) return;

    const totalOld = oldDebts.reduce((s,d) => s + d.remainingDebt, 0);

    let msg = `⚠️ <b>ESLATMA: Uzoq qarzlar</b>\n`;
    msg += `Jami: <b>${toMoney(totalOld)} so'm</b> (${oldDebts.length} ta)\n`;
    msg += `──────────────────\n\n`;

    for (const d of oldDebts.slice(0, 8)) {
        const days = Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400_000);
        const phone = d.customerPhone ? `📞 ${d.customerPhone}` : "";
        msg += `• <b>${toMoney(d.remainingDebt)} so'm</b> — ${days} kun\n`;
        if (d.note) msg += `  <i>${d.note}</i>\n`;
        if (phone)  msg += `  ${phone}\n`;
        msg += "\n";
    }

    if (oldDebts.length > 8) {
        msg += `<i>...va yana ${oldDebts.length-8} ta</i>`;
    }

    await bot.sendMessage(GROUP_CHAT_ID, msg, { parse_mode: "HTML" }).catch(()=>{});
    console.log(`[smartNotifier] Qarz ogohlantirish: ${oldDebts.length} ta`);
}

// ═══════════════════════════════════════════════════
// 4. PAST SAVDO OGOHLANTIRISH
// Agar soat 15:00 gacha savdo 50 000 dan kam bo'lsa
// ═══════════════════════════════════════════════════
async function checkLowSales(bot) {
    if (!GROUP_CHAT_ID) return;

    const from = startOfTashkentDay();
    const to   = new Date();

    const agg = await Sale.aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: null, total: { $sum: "$paidTotal" }, count: { $sum: 1 } } }
    ]);

    const total = agg[0]?.total || 0;
    const count = agg[0]?.count || 0;

    if (total < 50_000) {
        await bot.sendMessage(
            GROUP_CHAT_ID,
            `📉 <b>Diqqat!</b> Bugun soat 15:00 gacha atigi <b>${toMoney(total)} so'm</b> (${count} ta sotuv).\n\n` +
            `Faolroq bo'lish vaqti! 💪`,
            { parse_mode: "HTML" }
        ).catch(()=>{});
        console.log("[smartNotifier] Past savdo ogohlantirish yuborildi");
    }
}

// ═══════════════════════════════════════════════════
// 5. BAYRAM OLDIDAN MASS XABAR
// Bayramdan 3 kun oldin — cashback mijozlarga
// ═══════════════════════════════════════════════════
async function sendHolidayPromo(bot, holiday) {
    const customers = await Customer.find({ points: { $gte: 0 } }).limit(200).lean();
    if (!customers.length) return;

    let sent = 0;
    for (const c of customers) {
        try {
            const ballText = c.points > 0
                ? `\n💰 Sizda <b>${toMoney(c.points)} so'm</b> cashback ball bor — ishlatish imkoniyati!`
                : "";

            await bot.sendMessage(
                c.tgId,
                `🎉 <b>${holiday.name} muborak!</b>\n\n` +
                `Bayram uchun maxsus tort buyurtma bering!\n` +
                `🎂 Shokoladniy, Rafaello, Bento va boshqalar` +
                ballText + `\n\n` +
                `📍 Sang'sentir, Anhor minosi\n` +
                `📞 +998 77 737 77 40\n` +
                `📲 @totli_tortlari`,
                { parse_mode: "HTML" }
            );
            sent++;
            await new Promise(r => setTimeout(r, 300));
        } catch {}
    }

    if (GROUP_CHAT_ID) {
        await bot.sendMessage(
            GROUP_CHAT_ID,
            `🎉 <b>${holiday.name}</b> promo: <b>${sent}</b> mijozga yuborildi`,
            { parse_mode: "HTML" }
        ).catch(()=>{});
    }
    console.log(`[smartNotifier] Holiday promo ${holiday.name}: ${sent} ta`);
}

// ═══════════════════════════════════════════════════
// BAYRAMLAR RO'YXATI
// ═══════════════════════════════════════════════════
const HOLIDAYS = [
    { month:1,  day:1,  name:"Yangi yil 🎆",         boost:3.2 },
    { month:2,  day:14, name:"Sevgillilar kuni 💝",    boost:2.8 },
    { month:3,  day:8,  name:"8-Mart 💐",             boost:3.5 },
    { month:3,  day:21, name:"Navro'z 🌸",            boost:3.8 },
    { month:6,  day:1,  name:"Bolalar kuni 👶",        boost:2.2 },
    { month:8,  day:31, name:"Istiqlol kuni 🇺🇿",     boost:2.5 },
    { month:9,  day:1,  name:"Bilimlar kuni 📚",      boost:2.3 },
    { month:12, day:31, name:"Yangi yil arafasi 🎉",  boost:4.0 },
];

function getUpcomingHoliday() {
    const now  = tashkentNow();
    const year = now.getUTCFullYear();
    for (const h of HOLIDAYS) {
        const d    = new Date(Date.UTC(year, h.month-1, h.day) - 5*3600_000);
        const diff = Math.ceil((d.getTime() - now.getTime()) / 86400_000);
        if (diff >= 0 && diff <= 7) return { ...h, daysLeft: diff };
    }
    return null;
}

// ═══════════════════════════════════════════════════
// SCHEDULER — Barcha schedulerlarni ishga tushirish
// ═══════════════════════════════════════════════════
function scheduleSmartNotifier(bot) {
    // 1. Tort rejasi — har kuni 21:00 (Tashkent)
    schedule.scheduleJob({ hour: 16, minute: 0, tz: "UTC" }, () => {
        sendDetailedBakerPlan(bot).catch(e => console.error("[smartNotifier] baker:", e.message));
    });

    // 2. Cashback eslatma — har shanba 10:00
    schedule.scheduleJob({ dayOfWeek: 6, hour: 5, minute: 0, tz: "UTC" }, () => {
        sendCashbackReminders(bot).catch(e => console.error("[smartNotifier] cashback:", e.message));
    });

    // 3. Qarz ogohlantirish — har kuni 09:00
    schedule.scheduleJob({ hour: 4, minute: 0, tz: "UTC" }, () => {
        sendDebtAlerts(bot).catch(e => console.error("[smartNotifier] debt:", e.message));
    });

    // 4. Past savdo tekshirish — har kuni 15:00
    schedule.scheduleJob({ hour: 10, minute: 0, tz: "UTC" }, () => {
        checkLowSales(bot).catch(e => console.error("[smartNotifier] lowSales:", e.message));
    });

    // 5. Bayram promo — har kuni 09:30 da tekshiradi
    schedule.scheduleJob({ hour: 4, minute: 30, tz: "UTC" }, () => {
        const hint = getUpcomingHoliday();
        if (hint && hint.daysLeft === 3) {
            sendHolidayPromo(bot, hint).catch(e => console.error("[smartNotifier] holiday:", e.message));
        }
    });

    console.log("✅ smartNotifier scheduler ishga tushdi (5 ta vazifa)");
}

module.exports = {
    scheduleSmartNotifier,
    sendDetailedBakerPlan,
    sendCashbackReminders,
    sendDebtAlerts,
    checkLowSales,
    sendHolidayPromo,
    getUpcomingHoliday,
};
