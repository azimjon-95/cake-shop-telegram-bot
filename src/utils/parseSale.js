const { findAllNumbers } = require("./money");

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
    return String(text || "").replace(
        /(?:\btel\b|\btelefon\b)\s*\+?\d{9,12}/gi,
        " "
    );
}

// ================= NAME =================
function cleanName(segment) {
    let s = String(segment || "");
    s = stripTelPart(s);
    s = s.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");
    s = s.replace(/[\d\s.,]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s || "Noma’lum";
}

// ================= SPLIT =================
function splitSegments(input) {
    const raw = String(input || "").trim();
    if (!raw) return [];

    // Agar vergul ishlatilgan bo'lsa — vergul bo'yicha ajratamiz
    if (raw.includes(",")) {
        return raw
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
    }

    // Vergulsiz bo'lsa — aqlli ajratamiz:
    // Har bir mahsulot: [nom ...] + [price] + (ixtiyoriy) [paid] + (keyingi nom...)
    const tokens = raw.split(/\s+/);

    const isMoneyToken = (t) => {
        const onlyDigits = String(t).replace(/[^\d]/g, "");
        return onlyDigits.length >= 4; // >= 1000
    };

    const isTelToken = (t) => /^(tel|telefon)$/i.test(t);

    const segments = [];
    let cur = [];

    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];

        // tel/telefon bo'lsa — qolganini oxirgi segmentga qo'shib yuboramiz
        if (isTelToken(t)) {
            if (cur.length === 0) cur.push(t);
            else cur.push(t);

            if (tokens[i + 1]) {
                cur.push(tokens[i + 1]); // raqam
                i += 2;
            } else {
                i += 1;
            }
            segments.push(cur.join(" "));
            cur = [];
            break;
        }

        cur.push(t);

        // price topilganda segment yopiladi, lekin keyingi token money bo'lsa bu paid bo'lishi mumkin
        if (isMoneyToken(t)) {
            // ixtiyoriy paid: keyingi token ham money bo'lsa, uni ham shu segmentga qo'shamiz
            if (i + 1 < tokens.length && isMoneyToken(tokens[i + 1])) {
                cur.push(tokens[i + 1]);
                i += 2;
                segments.push(cur.join(" "));
                cur = [];
                continue;
            }

            // faqat price bo'lsa
            i += 1;
            segments.push(cur.join(" "));
            cur = [];
            continue;
        }

        i += 1;
    }

    if (cur.length) segments.push(cur.join(" "));

    return segments.map((x) => x.trim()).filter(Boolean);
}



// ================= MAIN =================
function parseSaleMessage(input) {
    const segments = splitSegments(input);

    // ✅ Telefon faqat "tel" bo‘lsa olinadi
    const phone = extractPhoneOnlyTel(input);

    const items = [];

    for (let seg of segments) {
        // 1️⃣ telefonni olib tashlaymiz
        seg = stripTelPart(seg);

        // 2️⃣ qty
        const qty = parseQty(seg);

        // 3️⃣ qty matnini olib tashlaymiz
        const segWithoutQty = seg.replace(/\b\d+\s*(ta|dona|x)\b/gi, " ");

        // 4️⃣ pul raqamlarini olamiz
        const nums = findAllNumbers(segWithoutQty);

        // himoya: mayda sonlar (2, 3) pul bo‘lib ketmasin
        const filtered = nums.filter(
            (n) => n >= 1000 && n < 100000000
        );

        if (filtered.length === 0) continue;

        const price = filtered[0];
        const paid = filtered.length >= 2 ? filtered[1] : null;

        const name = cleanName(segWithoutQty);

        items.push({
            name,
            qty,
            price,
            paid
        });
    }

    return { items, phone };
}

module.exports = { parseSaleMessage };
