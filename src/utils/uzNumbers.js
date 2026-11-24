// src/utils/uzNumbers.js
// Ovozdan olingan matndagi summalarni MUSTAQIL (AI siz) topadi.
// Maqsad: AI qaytargan narx haqiqatan ham aytilgan gapda bormi — tekshirish.

const UNITS = { bir: 1, bitta: 1, ikki: 2, ikkita: 2, uch: 3, uchta: 3, tort4: 4, besh: 5, beshta: 5, olti: 6, yetti: 7, sakkiz: 8, toqqiz: 9 };
const TENS = { on: 10, yigirma: 20, ottiz: 30, qirq: 40, ellik: 50, oltmish: 60, yetmish: 70, sakson: 80, toqson: 90 };

// Rus tili (STT ruscha yozib qo'yishi mumkin)
const RU_UNITS = { один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
    десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
    двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
    сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };
const RU_THOUSAND = /^(тысяча|тысячи|тысяч|тыс)$/;
const RU_MILLION = /^(миллион|миллиона|миллионов|млн)$/;

function norm(s) {
    return String(s || "").toLowerCase()
        .replace(/['‘’`ʻʼ]/g, "")          // to'rt → tort, o'n → on
        .replace(/ё/g, "е")
        .replace(/[^a-z0-9а-я\s]/g, " ")
        .replace(/\s+/g, " ").trim();
}

// "to'rt" (4) va "tort" (keyk) normalizatsiyada bir xil bo'ladi → faqat "tort" + (ming|yuz|ta|dona) bo'lsa 4
function wordValue(tok, next, tortIsFour) {
    if (tok === "tort") return tortIsFour ? { unit: 4 } : null;
    if (UNITS[tok]) return { unit: UNITS[tok] };
    if (TENS[tok])  return { unit: TENS[tok] };
    return null;
}

// Aytilgan barcha mumkin bo'lgan summalar to'plami
function spokenAmountsOnce(text, tortIsFour) {
    const toks = norm(text).split(" ").filter(Boolean);
    const out = new Set();

    let total = 0, group = 0, has = false, hadMing = false;
    const flush = () => {
        if (!has) return;
        const v = total + group;
        if (v > 0) {
            out.add(v);
            if (!hadMing && v < 1000) out.add(v * 1000);   // "140" = 140 ming (sotuvchi qisqartmasi)
        }
        total = 0; group = 0; has = false; hadMing = false;
    };

    for (let i = 0; i < toks.length; i++) {
        const t = toks[i], next = toks[i + 1];
        let m;
        if ((m = t.match(/^(\d+)(ming|min|minga|mingga|mingdan)$/))) {
            // "140ming": oldingi raqam guruhini yopamiz
            flush();
            out.add(Number(m[1]) * 1000);
            continue;
        }
        if (/^\d+$/.test(t)) {
            // "140 000" kabi bo'lingan raqam
            if (has && group && t.length === 3 && !hadMing && /^\d+$/.test(toks[i - 1]) ) { group = group * 1000 + Number(t); has = true; continue; }
            group += Number(t); has = true; continue;
        }
        if (/^(ming|min|minga|mingga|mingdan)$/.test(t)) {
            if (has || group) {
                total += (group || 1) * 1000; group = 0; has = true; hadMing = true;
                if (t !== "ming" && t !== "min") flush();   // "mingdan/minga" — son shu yerda tugaydi
                continue;
            }
            continue;
        }
        if (/^(million|mln|milyon)/.test(t)) { total += (group || 1) * 1e6; group = 0; has = true; hadMing = true; continue; }
        if (t === "yuz") { group = (group === 0 ? 1 : group) * 100; has = true; continue; }
        if (RU_UNITS[t]) { group += RU_UNITS[t]; has = true; continue; }
        if (RU_THOUSAND.test(t)) { total += (group || 1) * 1000; group = 0; has = true; hadMing = true; continue; }
        if (RU_MILLION.test(t)) { total += (group || 1) * 1e6; group = 0; has = true; hadMing = true; continue; }
        const w = wordValue(t, next, tortIsFour);
        if (w) { group += w.unit; has = true; continue; }
        flush();
    }
    flush();
    return out;
}

// "tort" = keyk ham, to'rt (4) ham bo'lishi mumkin → ikkala o'qilishning birlashmasi
function spokenAmounts(text) {
    return new Set([...spokenAmountsOnce(text, false), ...spokenAmountsOnce(text, true)]);
}

module.exports = { spokenAmounts };
