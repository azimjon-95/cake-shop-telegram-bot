// src/services/backupScheduler.js
// ✅ Har kuni kassa yopilganda (yoki soat 23:30 da) avtomatik backup

const { sendBackupToTelegram } = require("./backup");
const { BACKUP_CHAT_ID }       = require("../config");

let _bot        = null;
let _timer      = null;
let _lastDate   = "";   // "2025-04-10" — bir kunda bir marta yuborilsin

function pad(v) { return String(v).padStart(2, "0"); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// Keyingi soat 23:30 gacha necha millisekund qolgan
function msUntil2330() {
  const now   = new Date();
  const target = new Date(now);
  target.setHours(23, 30, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

// ── Kassa yopilganda chaqiriladi (closeCash.js dan)
async function triggerBackupOnClose() {
  if (!_bot || !BACKUP_CHAT_ID) return;
  const today = todayStr();
  if (_lastDate === today) {
    console.log("[backup] Bugun allaqachon yuborilgan:", today);
    return;
  }
  _lastDate = today;
  await sendBackupToTelegram(_bot).catch(e =>
    console.error("[backup] triggerBackupOnClose error:", e.message)
  );
}

// ── Kunlik soat 23:30 da avtomatik (kassa yopilmagan bo'lsa ham)
function scheduleDailyAt2330(bot) {
  _bot = bot;
  if (!BACKUP_CHAT_ID) {
    console.warn("[backup] BACKUP_CHAT_ID yo'q — scheduler ishlamaydi");
    return;
  }

  const runDaily = async () => {
    const today = todayStr();
    if (_lastDate !== today) {
      console.log("[backup] 23:30 backup boshlanmoqda...");
      _lastDate = today;
      await sendBackupToTelegram(bot).catch(e =>
        console.error("[backup] 23:30 scheduler error:", e.message)
      );
    }
    // Ertangi 23:30 ga qayta rejalashtirish
    clearTimeout(_timer);
    _timer = setTimeout(runDaily, msUntil2330());
  };

  clearTimeout(_timer);
  _timer = setTimeout(runDaily, msUntil2330());

  const h = Math.round(msUntil2330() / 60000);
  console.log(`[backup] ✅ Scheduler ulandi. Keyingi backup ~${h} daqiqadan keyin`);
}

function stopScheduler() {
  clearTimeout(_timer);
  _timer = null;
}

module.exports = { scheduleDailyAt2330, triggerBackupOnClose, stopScheduler };
