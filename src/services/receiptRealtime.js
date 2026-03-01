// src/services/receiptRealtime.js
const ReceiptToken = require("../models/ReceiptToken");
const Sale = require("../models/Sale");
const { makeQrPngBuffer } = require("../services/qr");
const { CUSTOMER_BOT_USERNAME, MIN_QR_PAID } = require("../config");

function roomKey(token) {
    return `receipt:${token}`;
}

async function buildReceiptPayload(token) {
    const doc = await ReceiptToken.findOne({ token }).lean();
    if (!doc) return null;

    const sale = await Sale.findById(doc.saleId).lean();
    if (!sale) return null;

    let deepLink = null;
    let qrDataUrl = null;

    if (CUSTOMER_BOT_USERNAME) {
        deepLink = `https://t.me/${CUSTOMER_BOT_USERNAME}?start=${token}`;
        const pngBuffer = await makeQrPngBuffer(deepLink);
        qrDataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
    }

    return {
        sale: { ...sale, deepLink, qrDataUrl },
        scansCount: doc.scansCount || 0,
        minPaid: MIN_QR_PAID,
        deepLink,
        qrDataUrl,
        meta: { token, ts: Date.now() },
    };
}

function createReceiptRealtime({ io }) {
    io.on("connection", (socket) => {
        socket.on("receipt:subscribe", async ({ token }) => {
            if (!token) {
                socket.emit("receipt:error", { message: "token required" });
                return;
            }

            // old roomdan chiq
            if (socket.data.receiptRoom) socket.leave(socket.data.receiptRoom);

            const key = roomKey(token);
            socket.data.receiptRoom = key;
            socket.join(key);

            try {
                const payload = await buildReceiptPayload(token);
                if (!payload) {
                    socket.emit("receipt:error", { message: "not found" });
                    return;
                }
                socket.emit("receipt:update", payload);
            } catch (e) {
                socket.emit("receipt:error", { message: e?.message || "RECEIPT_ERROR" });
            }
        });
    });

    // tashqaridan chaqirish uchun helper
    async function push(token) {
        const key = roomKey(token);
        const payload = await buildReceiptPayload(token);
        if (payload) io.to(key).emit("receipt:update", payload);
    }

    return { push };
}

module.exports = { createReceiptRealtime };