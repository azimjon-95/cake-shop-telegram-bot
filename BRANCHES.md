# Filiallar (Totli Sang / Totli To'da)

Bitta bot, bitta server, bitta baza. Har yozuvda `branchId` bor.

## Asosiy qoida
`branchId` **yo'q / null** bo'lgan har qanday eski yozuv — **Sang** ga tegishli.
Eski ma'lumotni ko'chirish yoki o'zgartirish **shart emas**. Sang balansi eski `balance` kalitida qoladi,
To'da balansi `balance:toda` kalitida.

## Qanday ishlaydi
- **Kirish:** xodim `/start` → do'kon PIN-kodi (`PIN_SANG` / `PIN_TODA`). PIN filialni belgilaydi.
  PIN bilan kirgan xodim keyingi safar PIN so'ramaydi. 5 xato urinish → 15 daqiqa blok.
- **Admin:** `/filial` — PIN siz filialni almashtiradi. Dashboardda Hammasi / Sang / To'da.
- **Kontekst:** `src/services/branches.js` — `runWithBranch` (AsyncLocalStorage). Bot handlerlari
  foydalanuvchi filiali bilan o'raladi, shuning uchun storage, notify, hisobotlar filialni o'zi biladi.
- **Guruh xabarlari:** tepada `🏪 Totli Sang` / `🏪 Totli To'da`. Alohida guruh kerak bo'lsa
  `GROUP_CHAT_ID_TODA` ni to'ldiring.
- **Balans:** har filial o'z balansi. Chiqim va kirim (taminot) faqat o'z balansidan.
  Boshqa filial qarzini to'lab / o'chirib bo'lmaydi (admin o'chira oladi).
- **Kassa yopish:** har filial o'zini yopadi (hisobot, qolgan tort, rasm/video, o'z guruhi).
- **Firmalar** umumiy; qarz filial bo'yicha ajratiladi (`Supplier.branchDebts`).
- **Mijozlar va cashback** umumiy (bitta brend).
- **Chek:** sarlavhada filial nomi/manzili. Print Station: `/print?branch=sang` va `/print?branch=toda`.

## Yangi filial qo'shish
`src/services/branches.js` → `getBranches()` ga yana bir yozuv + `.env` da PIN. Boshqa kod o'zgarmaydi.

## Ishga tushirish (To'da)
1. `.env`: `PIN_SANG`, `PIN_TODA` (bir xil bo'lmasin).
2. Deploy → `/filial` → To'da → `💰 Balansni tahrirlash` bilan To'da boshlang'ich kassasini kiriting
   (chiqim uchun balans kerak).
3. To'da telefonida `https://<webapp>/print?branch=toda` ochiq tursin.

## 🧪 TEST filial (dasturchi)
`PIN_TEST` ni .env ga yozsangiz yoqiladi. Shu PIN bilan botga kirgan foydalanuvchi **TEST** filialida ishlaydi:
- barcha sotuvchi funksiyalari (sotuv, ovozli sotuv, chiqim, kirim, qarz, kassa yopish) to'liq ishlaydi;
- pul alohida `balance:test` da (boshlang'ich `TEST_START_BALANCE`), Sang/To'da balansiga tegmaydi;
- guruhga ketgan xabarlar `TEST_GROUP_DELETE_SEC` (60s) dan keyin avtomatik o'chadi;
- `branchId:"test"` yozuvlari `TEST_DATA_TTL_MIN` (60 daqiqa) dan keyin bazadan o'chadi, balans boshlang'ichga qaytadi;
- jami hisobot/dashboard/oylik hisobot/firma qarzi jamiga kirmaydi; mijozga cashback ball berilmaydi;
- admin `/filial` orqali ham TEST ga o'ta oladi.
Cheklov: o'chirish taymerlari xotirada — bot qayta ishga tushsa, shu paytdagi guruh xabarlari qolib ketishi mumkin (ma'lumotlar baribir tozalanadi).
