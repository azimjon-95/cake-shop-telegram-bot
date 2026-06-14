// src/services/printSignal.js
// Sotuv bo'lishi bilan PWA ga print signal yuboradi
// PWA uni olib RawBT orqali Bluetooth printerga chiqaradi

const { WEBAPP_URL } = require("../config");

function fmt(n) { return Number(n||0).toLocaleString("uz-UZ"); }

function fmtDate(d) {
    const dt = new Date(d);
    const pad = v => String(v).padStart(2,"0");
    // Tashkent UTC+5
    const ms = dt.getTime() + 5*3600_000;
    const t  = new Date(ms);
    return `${pad(t.getUTCDate())}.${pad(t.getUTCMonth()+1)}.${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

// ── 58mm ESC/POS matn generatsiya ──────────────────────
// RawBT oddiy matn qabul qiladi (ESC/POS buyruqlarsiz ham chiqaradi)
function buildReceiptText(sale, cashbackBall, qrUrl) {
    const W = 32; // 58mm qog'ozda ~32 belgi sig'adi
    const line  = "─".repeat(W);
    const dline = "═".repeat(W);
    const center = (s) => {
        const pad = Math.max(0, Math.floor((W - s.length) / 2));
        return " ".repeat(pad) + s;
    };
    const row = (l, r) => {
        const space = Math.max(1, W - l.length - r.length);
        return l + " ".repeat(space) + r;
    };

    const lines = [];

    // Header
    lines.push(center("TOTLI TORTLAR"));
    lines.push(center("Sang'sentir, Anhor minosi"));
    lines.push(center("+998 77 737 77 40"));
    lines.push(dline);

    // Meta
    lines.push(row("Chek:", `#${sale.orderNo || "—"}`));
    lines.push(row("Sana:", fmtDate(sale.createdAt)));
    lines.push(row("Kassir:", sale.seller?.tgName || "—"));
    if (sale.phone) lines.push(row("Tel:", sale.phone));
    lines.push(line);

    // Items
    lines.push("Mahsulot        Son    Narx");
    lines.push(line);

    for (const it of (sale.items || [])) {
        const qty   = Number(it.qty   || 1);
        const price = Number(it.price || 0);
        const total = qty * price;
        const name  = String(it.name || "").slice(0, 16).padEnd(16);
        const qtyS  = String(qty).padStart(3);
        const totS  = fmt(total).padStart(10);
        lines.push(`${name}${qtyS}  ${totS}`);
    }

    lines.push(line);

    // Totals
    lines.push(row("Jami:", `${fmt(sale.total)} som`));
    if (Number(sale.debtTotal) > 0) {
        lines.push(row("Qarz:", `${fmt(sale.debtTotal)} som`));
    }
    if (Number(sale.change || 0) > 0) {
        lines.push(row("Qaytim:", `${fmt(sale.change)} som`));
    }
    lines.push(dline);
    lines.push(row("TO'LANDI:", `${fmt(sale.paidTotal)} som`));
    lines.push(dline);

    // Cashback
    if (cashbackBall > 0) {
        lines.push("");
        lines.push(center("★ CASHBACK 10% ★"));
        lines.push(center(`+${fmt(cashbackBall)} ball`));
        lines.push(center("QR skanerlang:"));
        // QR URL ni qisqa ko'rsatamiz (RawBT QR chiqara olmaydi matn rejimida)
        if (qrUrl) {
            lines.push(center("Telegram botga kiring:"));
            lines.push(center("@totli_bonuslari_bot"));
        }
        lines.push(line);
    }

    // Footer
    lines.push("");
    lines.push(center("Xaridingiz uchun rahmat!"));
    lines.push(center("Qayta keling :)"));
    lines.push(center("@totli_tortlari"));
    lines.push("");
    lines.push(center("* * * * *"));
    lines.push("\n\n\n"); // Qog'oz kesish uchun bo'sh joy

    return lines.join("\n");
}

// ── Socket.IO orqali PWA ga signal yuborish ──────────
function emitPrintSignal({ sale, receiptToken }) {
    if (!global.io) return;

    const cashbackBall = Math.floor(Number(sale.paidTotal || 0) * 0.10);
    const qrUrl = receiptToken?.token && WEBAPP_URL
        ? `${String(WEBAPP_URL).replace(/\/+$/, "")}/receipt?token=${receiptToken.token}`
        : null;

    const receiptText = buildReceiptText(sale, cashbackBall, qrUrl);

    // Barcha ulangan PWA larga yuborish
    global.io.emit("print:receipt", {
        receiptText,   // RawBT uchun matn
        sale: {
            orderNo:   sale.orderNo,
            total:     sale.total,
            paidTotal: sale.paidTotal,
            debtTotal: sale.debtTotal,
            change:    sale.change || 0,
            items:     sale.items,
            seller:    sale.seller,
            phone:     sale.phone,
            createdAt: sale.createdAt,
        },
        cashbackBall,
        qrUrl,
        token:    receiptToken?.token || null,
        webappUrl: qrUrl,
        ts:       Date.now(),
    });

    console.log(`[printSignal] emit: #${sale.orderNo} → ${fmt(sale.paidTotal)} som`);
}

module.exports = { emitPrintSignal, buildReceiptText };
