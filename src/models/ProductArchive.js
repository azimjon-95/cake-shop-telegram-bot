const mongoose = require("mongoose");

const ProductArchiveSchema = new mongoose.Schema(
    {
        // qaysi mahsulot edi (original id)
        productId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

        // action: "delete" yoki "expired"
        action: { type: String, enum: ["delete", "expired"], required: true, index: true },

        // sabab (admin yozadi)
        reason: { type: String, default: "" },

        // kim o‘chirdi
        deletedBy: {
            tgId: { type: Number, required: true },
            tgName: { type: String, default: "" },
        },

        deletedAt: { type: Date, default: Date.now, index: true },

        // mahsulotning snapshot’i (hammasi saqlanadi)
        snapshot: {
            code: String,
            name: String,
            category: String,
            desc: String,
            qty: Number,
            costPrice: Number,
            salePrice: Number,
            oldPrice: { type: Number, default: null },
            photo: {
                tgFileId: { type: String, default: null },
                url: { type: String, default: null },
            },
            createdBy: {
                tgId: Number,
                tgName: String,
            },
            stats: {
                soldQty: Number,
                revenue: Number,
            },
            isActive: Boolean,
            isDeleted: Boolean,
            createdAt: Date,
            updatedAt: Date,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("ProductArchive", ProductArchiveSchema);
