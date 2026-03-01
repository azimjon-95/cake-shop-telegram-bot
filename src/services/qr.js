// qr.js - generating QR codes for Telegram WebApp authentication
const QRCode = require("qrcode");

async function makeQrPngBuffer(text) {
    return QRCode.toBuffer(text, { type: "png", width: 380, margin: 1 });
}

module.exports = { makeQrPngBuffer };
