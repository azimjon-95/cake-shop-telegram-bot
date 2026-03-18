// src/utils/parseSale.js

function toIntMoneyLike(raw) {
    let s = String(raw || "").toLowerCase().trim();
    s = s.replace(/\s+/g, " ");
    s = s.replace(/so['’`]?m/gi, "").trim();

    // 120ming / 120min / 120 ming / 120 mingdan
    const thousandLike = s.match(/^(\d+(?:[.,]\d+)?)\s*(min|ming|minga|mingdan)$/i);
    if (thousandLike) {
        const n = Number(String(thousandLike[1]).replace(",", "."));
        return Math.round(n * 1000);
    }

    // oddiy raqam
    const digits = s.replace(/[^\d]/g, "");
    const n = parseInt(digits || "0", 10) || 0;

    // 1..999 => ming deb qabul qilamiz
    if (n >= 1 && n <= 999) return n * 1000;

    // 1000+ => o'zicha qoladi
    return n;
}

// ================= QTY =================
function parseQty(text) {
    const s = String(text || "").toLowerCase();
    const m = s.match(/\b(\d+)\s*(ta|dona|x)\b/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    return 1;
}

// ================= PHONE =================
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
    s = s.replace(/\b\d+\s*(min|ming|minga|mingdan)\b/gi, " ");

    // oxirdagi pul bo‘lib qolgan sonlarni ham tozalaymiz
    s = s.replace(/\b\d+\b/g, " ");

    s = s.replace(/[.,-]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();

    return s || "Noma’lum";
}

// ================= MONEY EXTRACT =================
function extractMoneyParts(seg) {
    const s = String(seg || "").toLowerCase().trim();

    // 1) hyphen: 12000-0 / 100ming-50 / 120-0
    const hyphen = s.match(/(\d+(?:[.,]\d+)?\s*(?:min|ming|minga|mingdan)?)\s*-\s*(\d+(?:[.,]\d+)?\s*(?:min|ming|minga|mingdan)?|0)\b/i);
    if (hyphen) {
        return {
            priceLike: toIntMoneyLike(hyphen[1]),
            secondLike: toIntMoneyLike(hyphen[2]),
            hasHyphen: true
        };
    }

    // 2) avval ming/min bilan yozilganlarni topamiz
    const thousandMatches = [...s.matchAll(/\d+(?:[.,]\d+)?\s*(?:min|ming|minga|mingdan)\b/gi)].map(m => m[0]);

    if (thousandMatches.length >= 1) {
        return {
            priceLike: toIntMoneyLike(thousandMatches[thousandMatches.length - 1]),
            secondLike: null,
            hasHyphen: false
        };
    }

    // 3) oddiy sonlar: oxirgi sonni narx deb olamiz
    const nums = s.match(/\d+/g);
    if (nums && nums.length) {
        const last = nums[nums.length - 1];
        const prev = nums.length > 1 ? nums[nums.length - 2] : null;

        return {
            priceLike: toIntMoneyLike(last),
            secondLike: prev ? toIntMoneyLike(prev) : null,
            hasHyphen: false
        };
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

    const tokens = raw.split(/\s+/);
    const segments = [];
    let cur = [];

    const isTelToken = (t) => /^(tel|telefon)$/i.test(t);

    const looksMoney = (t, next) => {
        const s = String(t || "").toLowerCase();
        const digits = s.replace(/[^\d]/g, "");
        const n = parseInt(digits || "0", 10) || 0;

        if (!digits) return false;

        // 120ming / 120min
        if (/(min|ming|minga|mingdan)$/.test(s)) return true;

        // 120 ming
        if (digits.length >= 1 && digits.length <= 3 && next && /^(min|ming|minga|mingdan)$/i.test(next)) return true;

        // 1000+
        if (digits.length >= 4) return true;

        // 1..999 bo‘lsa ham do‘kon logikasi bo‘yicha narx bo‘lishi mumkin
        if (n >= 1 && n <= 999) return true;

        // 12000-0
        if (s.includes("-") && s.replace(/[^\d]/g, "").length >= 1) return true;

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
            const digits = String(t).replace(/[^\d]/g, "");

            // 120 ming
            if (digits.length <= 3 && next && /^(min|ming|minga|mingdan)$/i.test(next)) {
                cur.push(next);
                i += 2;
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
        const segWithoutQty = seg.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");

        const { priceLike, secondLike, hasHyphen } = extractMoneyParts(segWithoutQty);

        const unitPrice = Number(priceLike || 0);
        if (unitPrice < 1000) continue;

        const total = qty * unitPrice;
        let paidTotal = total;

        if (hasHyphen) {
            const b = Number(secondLike || 0);

            if (qty > 1 && b > 0 && b < unitPrice) {
                paidTotal = Math.max(0, total - b);
            } else {
                paidTotal = Math.max(0, Math.min(b, total));
            }
        } else {
            if (/\b0\b/.test(segWithoutQty)) paidTotal = 0;
            else paidTotal = total;
        }

        const name = cleanName(segWithoutQty);

        items.push({
            name,
            qty,
            price: unitPrice,
            paid: paidTotal
        });
    }

    return { items, phone };
}

module.exports = { parseSaleMessage };
