// src/utils/parseSale.js  (FINAL - FIXED PAID/DEBT + QTY)
function toIntMoneyLike(raw) {
    // "140 000" / "140000" / "140,000" / "140.000" / "100min" / "100 ming" -> int
    let s = String(raw || "").toLowerCase().trim();

    // 100 ming / 100 min (bu funksiya bitta token uchun, lekin baribir himoya)
    s = s.replace(/\s+/g, " ");

    // "100min" / "100ming"
    if (/\d+\s*(min|ming)$/.test(s)) {
        const n = parseInt(s.replace(/[^\d]/g, ""), 10) || 0;
        return n * 1000;
    }

    // oddiy raqam
    const digits = s.replace(/[^\d]/g, "");
    return parseInt(digits || "0", 10) || 0;
}

// ================= QTY =================
function parseQty(text) {
    const s = String(text || "").toLowerCase();
    const m = s.match(/\b(\d+)\s*(ta|dona|x)\b/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    return 1;
}

// ================= PHONE (faqat tel bo'lsa) =================
function extractPhoneOnlyTel(text) {
    const m = String(text || "").match(/(?:\btel\b|\btelefon\b)\s*(\+?\d{9,12})/i);
    return m ? m[1].replace("+", "") : null;
}

function stripTelPart(text) {
    return String(text || "").replace(/(?:\btel\b|\btelefon\b)\s*\+?\d{9,12}/gi, " ");
}

// ================= NAME =================
function cleanName(segment) {
    let s = String(segment || "");
    s = stripTelPart(s);
    s = s.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");
    s = s.replace(/\b\d+\s*(min|ming)\b/gi, " ");
    s = s.replace(/[\d\s.,-]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s || "Noma’lum";
}

// ================= MONEY EXTRACT =================
function extractMoneyParts(seg) {
    // 1) "100000-0" / "12000-10000"
    // 2) "100 ming-0" / "100min-0"
    // 3) "12000" / "100 ming"
    const s = String(seg || "").toLowerCase();

    // hyphen bilan
    const m = s.match(/(\d[\d\s.,]*(?:min|ming)?)\s*-\s*(\d[\d\s.,]*(?:min|ming)?|0)\b/i);
    if (m) {
        const a = toIntMoneyLike(m[1]);
        const b = toIntMoneyLike(m[2]); // 0 ham tushadi
        return { priceLike: a, secondLike: b, hasHyphen: true };
    }

    // hyphensiz birinchi pul tokenini olamiz (min/ming ham)
    // "100 ming" ni ushlash uchun: "(\d+) (ming|min)"
    const m2 = s.match(/\b(\d[\d\s.,]*)\s*(min|ming)\b/i);
    if (m2) {
        const a = toIntMoneyLike(`${m2[1]}${m2[2]}`);
        return { priceLike: a, secondLike: null, hasHyphen: false };
    }

    // oddiy raqam
    const m3 = s.match(/\d{1,3}(?:[.,\s]\d{3})+|\d+/g);
    if (m3 && m3.length) {
        const a = toIntMoneyLike(m3[0]);
        // ikkinchi raqam bo'lsa (paid) ham olamiz (lekin 0 bo'lsa matchga tushmay qolishi mumkin)
        const b = m3[1] ? toIntMoneyLike(m3[1]) : null;
        return { priceLike: a, secondLike: b, hasHyphen: false };
    }

    return { priceLike: 0, secondLike: null, hasHyphen: false };
}

// ================= SPLIT =================
function splitSegments(input) {
    const raw = String(input || "").trim();
    if (!raw) return [];

    if (raw.includes(",")) {
        return raw.split(",").map(x => x.trim()).filter(Boolean);
    }

    // vergulsiz: oddiy usul — har "pul" ko‘ringanda segment yopiladi
    const tokens = raw.split(/\s+/);
    const segments = [];
    let cur = [];

    const isTelToken = (t) => /^(tel|telefon)$/i.test(t);

    const looksMoney = (t, next) => {
        const s = String(t || "").toLowerCase();
        const digits = s.replace(/[^\d]/g, "");
        if (digits.length >= 4) return true; // 1000+
        if (/(min|ming)$/.test(s) && digits.length >= 1) return true; // 100min/100ming
        if (digits.length >= 1 && digits.length <= 3 && next && /^(min|ming)$/i.test(next)) return true; // 100 ming
        if (s.includes("-") && s.replace(/[^\d]/g, "").length >= 4) return true; // 12000-0
        return false;
    };

    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        const next = tokens[i + 1];

        if (isTelToken(t)) {
            cur.push(t);
            if (tokens[i + 1]) cur.push(tokens[i + 1]);
            segments.push(cur.join(" "));
            cur = [];
            break;
        }

        cur.push(t);

        if (looksMoney(t, next)) {
            // "100 ming" bo'lsa next ni ham qo'shib yopamiz
            const digits = String(t).replace(/[^\d]/g, "");
            if (digits.length <= 3 && next && /^(min|ming)$/i.test(next)) {
                cur.push(next);
                i += 2;
                segments.push(cur.join(" "));
                cur = [];
                continue;
            }

            // keyingi token ham pul bo'lsa (paid bo'lishi mumkin)
            if (tokens[i + 1] && looksMoney(tokens[i + 1], tokens[i + 2])) {
                cur.push(tokens[i + 1]);
                // "100 ming" bo'lishi mumkin
                if (tokens[i + 2] && /^(min|ming)$/i.test(tokens[i + 2])) {
                    cur.push(tokens[i + 2]);
                    i += 3;
                } else {
                    i += 2;
                }
                segments.push(cur.join(" "));
                cur = [];
                continue;
            }

            i += 1;
            segments.push(cur.join(" "));
            cur = [];
            continue;
        }

        i += 1;
    }

    if (cur.length) segments.push(cur.join(" "));
    return segments.map(x => x.trim()).filter(Boolean);
}

// ================= MAIN =================
function parseSaleMessage(input) {
    const segments = splitSegments(input);
    const phone = extractPhoneOnlyTel(input);

    const items = [];

    for (let seg of segments) {
        seg = stripTelPart(seg);

        const qty = parseQty(seg);

        // qty matnini olib tashlaymiz
        const segWithoutQty = seg.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");

        // pulni olamiz (0 ham ushlanadi)
        const { priceLike, secondLike, hasHyphen } = extractMoneyParts(segWithoutQty);

        const unitPrice = Number(priceLike || 0);
        if (unitPrice < 1000) continue;

        const total = qty * unitPrice;

        // ✅ paid hisoblash:
        // 1) agar "A-B" bo'lsa:
        //    - qty>1 va B < unitPrice => B ni itemDebt deb olamiz => paid = total - B
        //    - aks holda B ni paid deb olamiz (0 ham bo'lishi mumkin)
        // 2) agar faqat A bo'lsa => paid = total (to‘liq to‘langan)
        let paidTotal = total;

        if (hasHyphen) {
            const b = Number(secondLike || 0);

            if (qty > 1 && b > 0 && b < unitPrice) {
                // misol: "3ta 12000-10000" => debt=10000, paid=36000-10000=26000
                paidTotal = Math.max(0, total - b);
            } else {
                // misol: "100000-0" => paid=0
                // misol: "100000-50000" => paid=50000
                paidTotal = Math.max(0, Math.min(b, total));
            }
        } else {
            // "100000 0" kabi holat: agar segment oxirida 0 bo'lsa, paid=0
            // (splitSegments ba'zan 0 ni ajratib beradi, lekin yana himoya)
            if (/\b0\b/.test(segWithoutQty)) paidTotal = 0;
            else if (secondLike != null && Number(secondLike) >= 0) {
                // "price paid" ko'rinish bo'lsa
                const b = Number(secondLike || 0);
                paidTotal = Math.max(0, Math.min(b, total));
            } else {
                paidTotal = total; // default: to‘liq
            }
        }

        const name = cleanName(segWithoutQty);

        items.push({
            name,
            qty,
            price: unitPrice,
            // ⚠️ MUHIM: paid bu TOTAL paid (qty hisobga olingan)
            paid: paidTotal
        });
    }

    return { items, phone };
}

module.exports = { parseSaleMessage };
