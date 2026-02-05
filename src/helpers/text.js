// src/bot/helpers/text.js
const dayjs = require("dayjs");
const { formatMoney } = require("../utils/money");

function getUserName(msg) {
    const u = msg.from || {};
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
    return name || u.username || String(u.id);
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function itemsToText(items) {
    return (items || []).map(i => `${i.name} x${i.qty} (${formatMoney(i.price)})`).join(", ");
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

module.exports = {
    getUserName,
    escapeHtml,
    itemsToText,
    formatDebtCard,
    helpText
};
