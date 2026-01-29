# Cake Shop Telegram Bot (Sotuv / Chiqim / Qarz / Kassa)

Bu Telegram bot dukonda tort va shirinliklar savdosini yuritish uchun:
- 🧁 Sotuvlarni qabul qiladi (har xil yozilish formatida ham)
- 💸 Chiqimlarni hisoblaydi
- 📌 Qarzlarni saqlaydi va qisman/to‘liq to‘lashni qo‘llaydi
- 🔒 “Kasani yopish”da kunlik hisobot + TXT fayl chiqaradi
- Har bir sotuv/chiqim haqida gruppaga chiroyli xabar yuboradi
- MongoDB + Redis bilan tezkor va ishonchli ishlaydi
- Parol 2 kunga eslab qoladi (Redis TTL)

## ✅ Talablar
- Node.js 18+ (yoki 20+ tavsiya)
- MongoDB (transaction uchun replica set tavsiya)
- Redis

## 📦 O‘rnatish

```bash
git clone <repo_url>
cd cake-shop-bot
npm i

# =========================================
.env fayl yarating:
cp .env .env

BOT_TOKEN=123456:ABCDEF
MONGO_URI=mongodb://localhost:27017/cake_bot
REDIS_URL=redis://localhost:6379
BOT_PASSWORD=1234
GROUP_CHAT_ID=-1001234567890
TZ=Asia/Tashkent
