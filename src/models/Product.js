const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
    {
        // Unikal kod: T0001 / T0012 (sizdagi format)
        code: {
            type: String,
            required: true,
            unique: true,
            index: true,
            trim: true,
            uppercase: true
        },

        // Mahsulot nomi
        name: {
            type: String,
            required: true,
            trim: true,
            index: true
        },

        // Kategoriya (masalan: tort, pirog, desert, ichimlik, aksessuar)
        category: {
            type: String,
            required: true,
            trim: true,
            index: true
        },

        // Tavsif (qisqa)
        desc: {
            type: String,
            default: "",
            trim: true
        },

        // Ombordagi qty (mavjud soni)
        qty: {
            type: Number,
            default: 0,
            min: 0
        },

        // Kelgan narx (tannarx)
        costPrice: {
            type: Number,
            default: 0,
            min: 0
        },

        // Sotish narxi (asosiy)
        salePrice: {
            type: Number,
            required: true,
            min: 0
        },
        channelPost: {
            chatId: { type: Number, default: null },
            messageId: { type: Number, default: null },
        },
        // Ixtiyoriy: eski narx / aksiya narxi bo‘lsa (keyin kerak bo‘ladi)
        oldPrice: {
            type: Number,
            default: null,
            min: 0
        },

        // Rasm (hozir bot uchun tgFileId yetadi, keyin url qo‘shib ketasiz)
        photo: {
            tgFileId: { type: String, default: null }, // hozir ishlatamiz
            url: { type: String, default: null }       // keyin web/insta uchun
        },

        // Kim qo‘shgan (admin)
        createdBy: {
            tgId: { type: Number, required: true },
            tgName: { type: String, default: "" }
        },

        // Oddiy statistika (keyin foydali bo‘ladi)
        stats: {
            soldQty: { type: Number, default: 0, min: 0 },
            revenue: { type: Number, default: 0, min: 0 } // tushgan pul
        },

        // Status
        isActive: { type: Boolean, default: true }, // katalogda ko‘rinsin/ko‘rinmasin
        isDeleted: { type: Boolean, default: false } // hozircha soft delete ishlatmasangiz ham turaveradi
    },
    { timestamps: true }
);

// isDeleted=true bo‘lganlarni chiqarib yuborish (agar keyin ishlatsangiz)
ProductSchema.index({ isDeleted: 1, isActive: 1, category: 1 });

module.exports = mongoose.model("Product", ProductSchema);
