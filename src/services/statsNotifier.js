// src/services/statsNotifier.js
// ✅ Kuniga 2 marta statistika SMS + "Statistikani ko'rish" WebApp btn
// 11:00–14:00 va 15:30–18:30 orasida random vaqt

const Sale    = require("../models/Sale");
const Expense = require("../models/Expense");
const Counter = require("../models/Counter");

const { GROUP_CHAT_ID, WEBAPP_URL, BOT_USERNAME, BAKER_TG_ID } = require("../config");

// ═══ MAHSULOT ANIQLASH — kuchli fuzzy matching ═══
// Sotuvchilar har xil yozadi: "Tort", "tort 120", "shokoladli", "Benazir" va h.k.

const TORT_WORDS = [
  // Asosiy so'z
  "tort",
  // Mashhur tort nomlari (qishloq tajribasi)
  "bonjur","mahroviy","damashniy","benazir","shekoladniy","shokoladli","shokol",
  "biskvit","bento","click","detski","medovik","napoleon","smetannik",
  "fruit","mevali","karamel","vanilli","qaymoq","kremli","malina",
  "limon","apelsin","gilos","yong'oq","fistiq","kokos","zanjabil",
  "praline","tiramisu kis","opera","black forest","blackforest",
  "dobos","esterhazy","sachertorte","domashniy","domashni",
  "bayram","toyliq","nikoh","yubiliy","birthday","bugungi",
];

const DRINK_WORDS = [
  "pepsi","cola","sprite","fanta","7up","lipton","nestea",
  "suv","water","ayron","kefir","qatiq","kompot","sharbat",
  "ichimlik","drink","sok","juice","limonad","mirinda",
  "lal anar","apple","apricot","mango","uzum sharbat",
  "mineral","borjomi","evian","aqua","zer su",
];

const PEROJ_WORDS = [
  "peroj","pirojnoe","ekler","eclair","cheesecake","cheese cake",
  "browni","brownie","cookie","kuki","makarun","macaron","muffin",
  "keks","cupcake","pirozhki","samsa","lavash","roll","roul",
];

function isTort(name = "", price = 0) {
  const s = name.toLowerCase().trim();

  // 1. Avval aniq so'z topilsa — tort
  if (TORT_WORDS.some(w => s.includes(w))) return true;

  // 2. Ism aniq emas, lekin narx yuqori — tort ehtimoli yuqori
  //    Oddiy ichamliq/peroj 60 000 dan oshmasligi kerak
  if (s.length > 0 && price >= 60_000) return true;

  // 3. Peroj so'zi bor — tort emas
  if (PEROJ_WORDS.some(w => s.includes(w))) return false;

  // 4. Ichimlik so'zi bor — tort emas
  if (DRINK_WORDS.some(w => s.includes(w))) return false;

  // 5. Nomi bo'sh yoki faqat raqam/belgi — narxga qarang
  if (s.replace(/[^a-zA-Zа-яёА-ЯЁa-zA-ZА-Яа-яЁёʻʼ]/g, "").length < 2) {
    return price >= 60_000;
  }

  return false;
}

function isIchimlik(name = "", price = 0) {
  const s = name.toLowerCase().trim();
  if (DRINK_WORDS.some(w => s.includes(w))) return true;
  // Juda arzon narx — ichimlik
  if (price > 0 && price <= 18_000) return true;
  return false;
}

function isPeroj(name = "", price = 0) {
  const s = name.toLowerCase().trim();
  if (PEROJ_WORDS.some(w => s.includes(w))) return true;
  if (price >= 8_000 && price <= 35_000 && !isIchimlik(name, price)) return true;
  return false;
}

// Narx bo'yicha taxmin (items bo'lmasa yoki nom noaniq bo'lsa)
function guessByPrice(price = 0) {
  if (price >= 60_000)  return "tort";
  if (price >= 8_000)   return "peroj";   // 8K–59K: perojnoe/keks
  return "ichimlik";                       // 8K dan past
}

function toMoney(n) { return Number(n||0).toLocaleString("uz-UZ"); }
function pad(v)     { return String(v).padStart(2,"0"); }

// Bugungi kunning statistikasini yig'ish
async function buildTodayStats() {
  // Toshkent vaqti UTC+5
  const now   = new Date();
  const lMs   = now.getTime() + 5*3600_000;
  const local = new Date(lMs);
  const y = local.getUTCFullYear();
  const m = pad(local.getUTCMonth()+1);
  const d = pad(local.getUTCDate());

  const dayStart = new Date(`${y}-${m}-${d}T00:00:00.000+05:00`);
  const dayEnd   = new Date(`${y}-${m}-${d}T23:59:59.999+05:00`);

  const [sales, expenses, counter] = await Promise.all([
    Sale.find({ createdAt:{ $gte:dayStart, $lte:dayEnd }}).lean(),
    Expense.find({ createdAt:{ $gte:dayStart, $lte:dayEnd }}).lean(),
    Counter.findOne({ key:"balance" }).lean(),
  ]);

  let totalIncome=0, tortCount=0, tortIncome=0, ichimlikIncome=0, otherIncome=0;
  const sellerMap = {};

  sales.forEach(sale => {
    const saleVal = Number(sale.paidTotal || sale.total || 0);
    totalIncome += saleVal;

    // Sotuvchi statistikasi
    const sName = sale.seller?.tgName || "Noma'lum";
    sellerMap[sName] = (sellerMap[sName]||0) + saleVal;

    const items = sale.items || [];
    if (items.length > 0) {
      items.forEach(it => {
        const qty   = Number(it.qty || 1);
        const price = Number(it.price || 0);
        const total = qty * price;

        if (isTort(it.name, price)) {
          tortCount  += qty;
          tortIncome += total;
        } else if (isIchimlik(it.name, price)) {
          ichimlikIncome += total;
        } else if (isPeroj(it.name, price)) {
          otherIncome += total; // perojnoye — boshqa ichida
        } else {
          // Nom noaniq — narxga qarab taxmin
          const guess = guessByPrice(price);
          if (guess === "tort") {
            tortCount  += qty;
            tortIncome += total;
          } else if (guess === "ichimlik") {
            ichimlikIncome += total;
          } else {
            otherIncome += total;
          }
        }
      });
    } else {
      // items umuman yo'q — umumiy summaga qarab taxmin
      const guess = guessByPrice(saleVal);
      if (guess === "tort") {
        // 1 ta tortning o'rtacha narxi ~120 000
        const approxQty = Math.max(1, Math.round(saleVal / 120_000));
        tortCount  += approxQty;
        tortIncome += saleVal;
      } else if (guess === "ichimlik") {
        ichimlikIncome += saleVal;
      } else {
        otherIncome += saleVal;
      }
    }
  });

  const totalExpense = expenses.reduce((s,x)=>s+Number(x.amount||0),0);
  const balance      = Number(counter?.value||0);
  const profit       = totalIncome - totalExpense;

  const topSellers = Object.entries(sellerMap)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,2);

  return {
    dateStr:`${d}.${m}.${y}`,
    saleCount: sales.length,
    totalIncome, tortCount, tortIncome, ichimlikIncome, otherIncome,
    totalExpense, balance, profit,
    topSellers,
  };
}

// ═══ Yaqin bayramni aniqlash (7 kun ichida) ═══
const HOLIDAYS_SIMPLE = [
  { month:1,  day:1,  name:"Yangi yil 🎆",           boost:3.2, tortPlan:18 },
  { month:1,  day:14, name:"Vatan himoyachilari 🎖",  boost:1.4, tortPlan:6  },
  { month:2,  day:14, name:"Sevgillilar kuni 💝",      boost:2.8, tortPlan:14 },
  { month:3,  day:8,  name:"8-Mart 💐",               boost:3.5, tortPlan:20 },
  { month:3,  day:21, name:"Navro'z 🌸",              boost:3.8, tortPlan:22 },
  { month:4,  day:1,  name:"Hazil kuni 😄",           boost:1.3, tortPlan:5  },
  { month:5,  day:9,  name:"Xotira kuni 🕊",          boost:1.5, tortPlan:6  },
  { month:5,  day:25, name:"So'nggi qo'ng'iroq 🎓",  boost:2.1, tortPlan:10 },
  { month:6,  day:1,  name:"Bolalar kuni 👶",          boost:2.2, tortPlan:11 },
  { month:8,  day:31, name:"Istiqlol kuni 🇺🇿",       boost:2.5, tortPlan:13 },
  { month:9,  day:1,  name:"Bilimlar kuni 📚",        boost:2.3, tortPlan:12 },
  { month:10, day:1,  name:"O'qituvchilar kuni 🏫",   boost:2.0, tortPlan:10 },
  { month:10, day:31, name:"Halloween 🎃",             boost:1.5, tortPlan:6  },
  { month:11, day:25, name:"Black Friday 🛒",          boost:1.6, tortPlan:7  },
  { month:12, day:8,  name:"Konstitutsiya kuni 📜",   boost:1.3, tortPlan:5  },
  { month:12, day:31, name:"Yangi yil arafasi 🎉",    boost:4.0, tortPlan:25 },
  // Suzuvchi
  { month:4,  day:5,  name:"Ro'za hayiti 🌙",         boost:4.2, tortPlan:24, floating:true },
  { month:6,  day:15, name:"Qurbon hayiti 🐑",         boost:4.0, tortPlan:22, floating:true },
];

function getNextHolidayHint() {
  const now  = new Date();
  const year = now.getFullYear();

  const upcoming = [];
  for (const h of HOLIDAYS_SIMPLE) {
    const d    = new Date(year, h.month-1, h.day);
    const diff = Math.ceil((d - now) / 86400000);
    if (diff >= 0 && diff <= 10) upcoming.push({ ...h, daysLeft: diff });
  }
  if (!upcoming.length) return null;
  return upcoming.sort((a,b) => a.daysLeft - b.daysLeft)[0];
}

function buildBakerMessage(stats, hint) {
  const pad2 = v => String(v).padStart(2,"0");
  const now = new Date();
  // Ertangi kun uchun plan
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = `${pad2(tomorrow.getDate())}.${pad2(tomorrow.getMonth()+1)}`;

  // Bugungi tort + ertangi reja
  const todayTort = stats.tortCount || 0;

  // Bayram bo'lsa — ko'p pishirish kerak
  let planTort, urgency, holidayLine;
  if (hint && hint.daysLeft <= 3) {
    planTort = hint.tortPlan;
    urgency  = "🚨 SHOSHILINCH! ";
    holidayLine = `
⚠️ <b>${hint.name}</b> — ${hint.daysLeft===0?"BUGUN!":hint.daysLeft===1?"ERTAGA!":hint.daysLeft+" kun qoldi"}`;
  } else if (hint && hint.daysLeft <= 7) {
    planTort = Math.round(hint.tortPlan * 0.7);
    urgency  = "📋 ";
    holidayLine = `
🎯 <b>${hint.name}</b> — ${hint.daysLeft} kun qoldi`;
  } else {
    // Oddiy kun — o'rtacha plan
    const avgTort = Math.max(4, Math.round(todayTort * 1.1));
    planTort = avgTort;
    urgency  = "";
    holidayLine = "";
  }

  const boostLine = hint
    ? `
📈 Bayram kuni savdo ×${hint.boost} oshadi`
    : "";

  return (
    `🍞 ${urgency}<b>ZUBAYDA, ERTANGI REJA</b>
` +
    `📅 ${tomorrowStr} uchun tayyorlik
` +
    `──────────────────

` +
    `📊 Bugun sotildi: <b>${todayTort} ta tort</b>
` +
    `💰 Bugungi tushum: <b>${toMoney(stats.totalIncome)} so'm</b>` +
    holidayLine +
    boostLine +
    `

🎂 <b>Ertaga pishirish rejasi:</b>
` +
    `   📦 Kamida <b>${planTort} ta tort</b> tayyor bo'lsin
` +
    `   ⏰ Ertalab soat 08:00 gacha yetkazib bering

` +
    (hint && hint.daysLeft <= 5
      ? `💡 <i>Maslahat: Buyurtmalar ko'p keladi, oldindan tayyorlaning!</i>

`
      : `💡 <i>Maslahat: ${todayTort > 0 ? `Bugun ${todayTort} ta ketdi, ertaga kamida shuncha tayyorlang.` : "Bugungi savdoga qarab reja tuzing."}</i>

`) +
    `📊 Batafsil statistika uchun:`
  );
}

function buildMessage(stats, timeLabel) {
  const tortShare = stats.totalIncome>0
    ? Math.round(stats.tortIncome/stats.totalIncome*100) : 0;

  const profitEmoji = stats.profit>0 ? "🟢" : stats.profit===0 ? "⚪" : "🔴";

  let sellers = "";
  if (stats.topSellers?.length) {
    sellers = "\n\n👥 <b>Sotuvchilar:</b>\n" +
      stats.topSellers.map((s,i)=>
        `  ${i===0?"🥇":"🥈"} ${s[0]}: ${toMoney(s[1])} so'm`
      ).join("\n");
  }

  // Reja tavsiyasi
  const hour = new Date().getUTCHours()+5; // Toshkent
  const remaining = Math.max(0, 21-hour);
  const avgPerHour = hour>8 ? Math.round(stats.totalIncome/(hour-8)) : 0;
  const predicted  = stats.totalIncome + avgPerHour*remaining;

  let reja = "";
  if (remaining>2 && avgPerHour>0) {
    reja = `\n\n📈 <b>Kun oxirigacha taxmin:</b> ~${toMoney(predicted)} so'm`;
    if (stats.tortCount>0) {
      const tortPerHour = stats.tortCount/(hour-8||1);
      const moreT = Math.round(tortPerHour*remaining);
      if (moreT>0) reja += `\n🎂 Yana ~${moreT} ta tort sotilishi mumkin`;
    }
  }

  return (
    `📊 <b>KUNLIK STATISTIKA</b>\n${stats.dateStr} · ${timeLabel}\n\n` +
    `🛍 Sotuvlar: <b>${stats.saleCount} ta</b>\n` +
    `💰 Tushgan:  <b>${toMoney(stats.totalIncome)} so'm</b>\n\n` +
    `🎂 Tortlar:  <b>${stats.tortCount} ta</b> — ${toMoney(stats.tortIncome)} so'm (${tortShare}%)\n` +
    `🥤 Ichimlik: ${toMoney(stats.ichimlikIncome)} so'm\n` +
    `📦 Boshqa:   ${toMoney(stats.otherIncome)} so'm\n\n` +
    `💸 Chiqim:   ${toMoney(stats.totalExpense)} so'm\n` +
    `${profitEmoji} Foyda:   <b>${toMoney(stats.profit)} so'm</b>\n` +
    `🏦 Balans:   ${toMoney(stats.balance)} so'm` +
    sellers + reja +
    `\n\n📈 <i>Statistika va prognozni ko'rish uchun:</i>`
  );
}

// Millisekundlarda qancha vaqt qolgan (Toshkent vaqtida)
function msUntilTashkent(h, m) {
  const now   = new Date();
  const lMs   = now.getTime() + 5*3600_000;
  const local = new Date(lMs);
  const y = local.getUTCFullYear();
  const mo= local.getUTCMonth();
  const d = local.getUTCDate();

  // Target = UTC h-5 soat (Toshkent h → UTC h-5)
  const targetUTC = Date.UTC(y, mo, d, h-5, m, 0);
  let diff = targetUTC - now.getTime();
  if (diff < 0) diff += 86_400_000;
  return diff;
}

function randomMinutes(fromH, toH) {
  const h = fromH + Math.floor(Math.random()*(toH-fromH));
  const m = Math.floor(Math.random()*60);
  return { h, m, label:`${pad(h)}:${pad(m)}` };
}

let _t1=null, _t2=null;

function scheduleStatsNotifier(bot) {
  if (!GROUP_CHAT_ID) {
    console.warn("[statsNotifier] GROUP_CHAT_ID topilmadi — o'tkazildi");
    return;
  }

  async function send(timeLabel) {
    try {
      const stats  = await buildTodayStats();
      const hint   = getNextHolidayHint();
      const text   = buildMessage(stats, timeLabel);
      const waUrl  = `${WEBAPP_URL||"https://cake.medme.uz"}/analytics`;

      const statsBtn = {
        inline_keyboard: [[{
          text: "📊 Statistikani ko'rish →",
          web_app: { url: waUrl },
        }]],
      };

      // 1️⃣ Guruhga statistika xabari
      await bot.sendMessage(GROUP_CHAT_ID, text, {
        parse_mode: "HTML",
        reply_markup: statsBtn,
      });
      console.log(`[statsNotifier] ✅ Guruh: ${timeLabel} yuborildi`);

      // 2️⃣ Zubaydaga alohida xabar (agar BAKER_TG_ID sozlangan bo'lsa)
      if (BAKER_TG_ID) {
        const bakerText = buildBakerMessage(stats, hint);
        await bot.sendMessage(BAKER_TG_ID, bakerText, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{
              text: "📊 Batafsil statistika →",
              web_app: { url: waUrl },
            }]],
          },
        });
        console.log(`[statsNotifier] ✅ Zubayda: ${timeLabel} yuborildi`);
      }

    } catch(e) {
      console.error("[statsNotifier]", e.message);
    }
  }

  function schedule() {
    const t1 = randomMinutes(11, 14);  // 11:00–13:59
    const t2 = randomMinutes(15, 19);  // 15:00–18:59

    const ms1 = msUntilTashkent(t1.h, t1.m);
    const ms2 = msUntilTashkent(t2.h, t2.m);

    console.log(`[statsNotifier] Keyingi: ${t1.label} va ${t2.label}`);

    clearTimeout(_t1); clearTimeout(_t2);

    _t1 = setTimeout(async () => {
      await send(t1.label);
      // Ertangi kun uchun soat 00:05 da qayta joylashtirish
      setTimeout(schedule, msUntilTashkent(0, 5));
    }, ms1);

    _t2 = setTimeout(() => send(t2.label), ms2);
  }

  schedule();
}

function stopStatsNotifier() {
  clearTimeout(_t1); clearTimeout(_t2);
}

module.exports = { scheduleStatsNotifier, stopStatsNotifier, buildTodayStats };
