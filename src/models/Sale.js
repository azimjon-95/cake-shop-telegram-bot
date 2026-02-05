const { mongoose } = require("../db");

const SaleItemSchema = new mongoose.Schema(
    {
        // eski tizim bilan mos
        name: { type: String, default: "" },

        qty: { type: Number, default: 1, min: 1 },

        // eski: price = bir dona sotilgan narx
        price: { type: Number, default: 0, min: 0 },

        // yangi: asosiy narx snapshot
        basePrice: { type: Number, default: 0, min: 0 },
        // yangi: real sotilgan narx (skidka bilan)
        soldPrice: { type: Number, default: 0, min: 0 },

        // 🖼️ RASM SNAPSHOT
        image: {
            tgFileId: { type: String, default: null },
            url: { type: String, default: null },
        },


        paid: { type: Number, default: null },

        note: { type: String, default: "" },
    },
    { _id: false }
);

const SaleSchema = new mongoose.Schema(
    {
        seller: {
            tgId: { type: Number, default: null },
            tgName: { type: String, default: "" },
        },

        phone: { type: String, default: null },

        items: {
            type: [SaleItemSchema],
            default: [],
        },

        // eski logika uchun
        total: { type: Number, default: 0 },

        paidTotal: { type: Number, default: 0 },

        debtTotal: { type: Number, default: 0 },

        // yangi kassa statistikasi
        totals: {
            subtotalBase: { type: Number, default: 0, min: 0 },
            subtotalSold: { type: Number, default: 0, min: 0 },
            discount: { type: Number, default: 0, min: 0 },
        },

        orderNo: { type: String, index: true, default: null },

        createdAt: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

module.exports = mongoose.model("Sale", SaleSchema);


// const { mongoose } = require("../db");

// const SaleItemSchema = new mongoose.Schema(
//     {
//         name: { type: String, required: true },
//         qty: { type: Number, required: true, default: 1 },
//         price: { type: Number, required: true }, // bir dona narx
//         paid: { type: Number, default: null } // agar bor bo‘lsa
//     },
//     { _id: false }
// );

// const SaleSchema = new mongoose.Schema(
//     {
//         seller: {
//             tgId: { type: Number, required: true },
//             tgName: { type: String, required: true }
//         },
//         phone: { type: String, default: null },
//         items: { type: [SaleItemSchema], required: true },
//         total: { type: Number, required: true }, // qty*price yig‘indi
//         paidTotal: { type: Number, required: true }, // real tushgan pul (qarz bo‘lsa kamroq)
//         debtTotal: { type: Number, required: true }, // total - paidTotal
//         orderNo: { type: String, index: true },
//         createdAt: { type: Date, default: Date.now },
//     },
//     { versionKey: false }
// );

// module.exports = mongoose.model("Sale", SaleSchema);
