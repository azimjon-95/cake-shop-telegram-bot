const Product = require("../models/Product");
const Sale = require("../models/Sale");
/* ================= Utils ================= */

function toNumber(v, def = 0) {
    const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : def;
}

function normStr(v, def = "") {
    const s = String(v ?? "").trim();
    return s ? s : def;
}

function normCategory(v) {
    // Kategoriya keyin filter/searchga qulay bo‘lsin:
    // "Tortlar" -> "tortlar", " Hot Dog " -> "hot dog"
    return normStr(v, "boshqa").toLowerCase();
}

/**
 * code format: T0001 / T0012
 * Bu yerda tekshiruv qattiq emas, xohlasangiz regexp bilan qiling.
 */
function normCode(v) {
    return normStr(v).toUpperCase();
}

function sanitizeUpdateBody(body = {}) {
    const out = {};

    if (body.code != null) out.code = normCode(body.code);
    if (body.name != null) out.name = normStr(body.name);
    if (body.category != null) out.category = normCategory(body.category);
    if (body.desc != null) out.desc = normStr(body.desc);

    if (body.qty != null) out.qty = Math.max(0, toNumber(body.qty, 0));
    if (body.costPrice != null) out.costPrice = Math.max(0, toNumber(body.costPrice, 0));
    if (body.salePrice != null) out.salePrice = Math.max(0, toNumber(body.salePrice, 0));

    if (body.oldPrice !== undefined) {
        out.oldPrice = body.oldPrice === null ? null : Math.max(0, toNumber(body.oldPrice, 0));
    }

    // ✅ photo merge
    const hasPhotoObj = body.photo && typeof body.photo === "object";
    const hasPhotoFileId = body.photoFileId != null;

    if (hasPhotoObj || hasPhotoFileId) {
        out.photo = {};

        if (hasPhotoObj) {
            if (body.photo.tgFileId !== undefined) out.photo.tgFileId = normStr(body.photo.tgFileId, null);
            if (body.photo.url !== undefined) out.photo.url = normStr(body.photo.url, null);
        }

        if (hasPhotoFileId) {
            out.photo.tgFileId = normStr(body.photoFileId, null);
        }
    }

    if (body.isActive != null) out.isActive = Boolean(body.isActive);
    if (body.isDeleted != null) out.isDeleted = Boolean(body.isDeleted);

    return out;
}


/* ================= Service ================= */

async function createProduct(payload) {
    // payload: { code, name, category, desc, qty, costPrice, salePrice, oldPrice, photoFileId/photo, createdBy }
    const code = normCode(payload.code);
    const name = normStr(payload.name);
    const category = normCategory(payload.category);

    const salePrice = Math.max(0, toNumber(payload.salePrice, 0));
    const costPrice = Math.max(0, toNumber(payload.costPrice, 0));
    const qty = Math.max(0, toNumber(payload.qty, 0));

    if (!code) throw new Error("code majburiy");
    if (!name) throw new Error("name majburiy");
    if (!category) throw new Error("category majburiy");
    if (!salePrice) throw new Error("salePrice majburiy (0 dan katta)");

    const createdBy = payload.createdBy || {};
    if (!createdBy.tgId) throw new Error("createdBy.tgId majburiy");

    const doc = await Product.create({
        code,
        name,
        category,
        desc: normStr(payload.desc, ""),
        qty,
        costPrice,
        salePrice,
        oldPrice: payload.oldPrice == null ? null : Math.max(0, toNumber(payload.oldPrice, 0)),
        photo: {
            tgFileId: payload.photo?.tgFileId ?? payload.photoFileId ?? null,
            url: payload.photo?.url ?? null
        },
        createdBy: {
            tgId: Number(createdBy.tgId),
            tgName: normStr(createdBy.tgName, "")
        },
        stats: { soldQty: 0, revenue: 0 },
        isActive: payload.isActive == null ? true : Boolean(payload.isActive),
        isDeleted: payload.isDeleted == null ? false : Boolean(payload.isDeleted)
    });

    return doc;
}

/**
 * query: { q, category, isActive, includeDeleted, limit, page, sort }
 * sort: "new" | "old" | "name" | "qty" | "price"
 */
async function listProducts(query = {}) {
    const filter = {};

    const includeDeleted = Boolean(query.includeDeleted);
    if (!includeDeleted) filter.isDeleted = false;

    if (query.isActive != null) {
        filter.isActive = Boolean(query.isActive);
    }

    if (query.category) {
        filter.category = normCategory(query.category);
    }

    if (query.q) {
        const q = normStr(query.q);
        // name yoki code bo‘yicha qidirish
        filter.$or = [
            { name: { $regex: q, $options: "i" } },
            { code: { $regex: q, $options: "i" } }
        ];
    }

    const limit = Math.min(100, Math.max(1, toNumber(query.limit, 30)));
    const page = Math.max(1, toNumber(query.page, 1));
    const skip = (page - 1) * limit;

    let sort = { createdAt: -1 };
    switch (String(query.sort || "new")) {
        case "old":
            sort = { createdAt: 1 };
            break;
        case "name":
            sort = { name: 1 };
            break;
        case "qty":
            sort = { qty: -1, createdAt: -1 };
            break;
        case "price":
            sort = { salePrice: -1, createdAt: -1 };
            break;
        default:
            sort = { createdAt: -1 };
    }

    const [items, total] = await Promise.all([
        Product.find(filter).sort(sort).skip(skip).limit(limit),
        Product.countDocuments(filter)
    ]);

    return {
        items,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
    };
}

async function getProductById(id) {
    const doc = await Product.findById(id);
    if (!doc || doc.isDeleted) throw new Error("Product topilmadi");
    return doc;
}

async function getProductByCode(code) {
    const c = normCode(code);
    const doc = await Product.findOne({ code: c, isDeleted: false });
    if (!doc) throw new Error("Product topilmadi");
    return doc;
}

/**
 * update product fields (name, category, prices, qty, photo, isActive...)
 * opts.actor optional
 */
async function updateProduct(id, body = {}) {
    const upd = sanitizeUpdateBody(body);

    // ✅ photo merge uchun: photo obyekt bo‘lsa dotga ochamiz
    const $set = { ...upd };
    if ($set.photo && typeof $set.photo === "object") {
        const p = $set.photo;
        delete $set.photo;

        if (p.tgFileId !== undefined) $set["photo.tgFileId"] = p.tgFileId;
        if (p.url !== undefined) $set["photo.url"] = p.url;
    }

    try {
        const doc = await Product.findOneAndUpdate(
            { _id: id, isDeleted: false },
            { $set },
            { new: true }
        );
        if (!doc) throw new Error("Product topilmadi");
        return doc;
    } catch (e) {
        if (String(e?.code) === "11000") throw new Error("Bu code allaqachon mavjud");
        throw e;
    }
}


/**
 * qty ni o'zgartirish: +n yoki -n
 * deltaQty: 5 => +5, -2 => -2
 */
async function adjustStock({ idOrCode, deltaQty }) {
    const delta = Math.trunc(toNumber(deltaQty, 0));
    if (!delta) throw new Error("deltaQty noto'g'ri");

    const filter = { isDeleted: false };
    if (String(idOrCode).match(/^[0-9a-fA-F]{24}$/)) filter._id = idOrCode;
    else filter.code = normCode(idOrCode);

    // qty manfiy bo'lib ketmasin:
    const doc = await Product.findOne(filter);
    if (!doc) throw new Error("Product topilmadi");

    const nextQty = doc.qty + delta;
    if (nextQty < 0) throw new Error("Ombor qty yetarli emas");

    doc.qty = nextQty;
    await doc.save();
    return doc;
}

/**
 * sotuv bo'lganda statistikani yangilash:
 * soldQty += qty
 * revenue += paidAmount (yoki itemTotal)
 */
async function addSaleStats({ productIdOrCode, soldQty, revenue }) {
    const q = Math.max(0, Math.trunc(toNumber(soldQty, 0)));
    const r = Math.max(0, toNumber(revenue, 0));
    if (!q && !r) return null;

    const filter = { isDeleted: false };
    if (String(productIdOrCode).match(/^[0-9a-fA-F]{24}$/)) filter._id = productIdOrCode;
    else filter.code = normCode(productIdOrCode);

    const doc = await Product.findOneAndUpdate(
        filter,
        {
            $inc: {
                "stats.soldQty": q,
                "stats.revenue": r
            }
        },
        { new: true }
    );

    return doc; // null bo'lishi ham mumkin
}

/**
 * delete:
 * softDelete: true => isDeleted=true (tavsiya)
 * softDelete: false => db dan o'chiradi (xavfli)
 */
async function deleteProduct(id, { softDelete = true } = {}) {
    if (softDelete) {
        const doc = await Product.findOneAndUpdate(
            { _id: id },
            { $set: { isDeleted: true, isActive: false } },
            { new: true }
        );
        if (!doc) throw new Error("Product topilmadi");
        return doc;
    }

    const res = await Product.deleteOne({ _id: id });
    if (!res.deletedCount) throw new Error("Product topilmadi");
    return true;
}

function normalizeCategoryRaw(v) {
    return String(v || "")
        .replace(/^📁\s*/i, "")  // "📁 tortlar" -> "tortlar"
        .trim()
        .toLowerCase();
}

async function listCategories() {
    const raw = await Product.distinct("category", { isDeleted: false, isActive: true });

    // normalize + unique + sort
    const norm = raw
        .map(normalizeCategoryRaw)
        .filter(Boolean);

    return Array.from(new Set(norm)).sort((a, b) => a.localeCompare(b));
}

async function closeSale({ chatId, seller, cartItems }) {
    if (!cartItems.length) throw new Error("Savat bo‘sh");

    let subtotalBase = 0;
    let subtotalSold = 0;

    const items = cartItems.map((it) => {
        const base = it.product.salePrice;
        const sold = it.soldPrice;

        subtotalBase += base * it.qty;
        subtotalSold += sold * it.qty;

        return {
            name: it.product.name,
            qty: it.qty,

            // eski tizim bilan mos
            price: sold,

            basePrice: base,
            soldPrice: sold,

            // 🖼️ rasm snapshot
            image: {
                tgFileId: it.product.photo?.tgFileId || null,
                url: it.product.photo?.url || null,
            },
        };
    });

    const discount = Math.max(0, subtotalBase - subtotalSold);

    // Ombor va statistika
    for (const it of cartItems) {
        await Product.updateOne(
            { _id: it.product._id, qty: { $gte: it.qty } },
            {
                $inc: {
                    qty: -it.qty,
                    "stats.soldQty": it.qty,
                    "stats.revenue": it.soldPrice * it.qty,
                },
            }
        );
    }

    const sale = await Sale.create({
        seller,
        items,

        // eski tizim
        total: subtotalBase,
        paidTotal: subtotalSold,
        debtTotal: subtotalBase - subtotalSold,

        // yangi tizim
        totals: {
            subtotalBase,
            subtotalSold,
            discount,
        },
    });

    return sale;
}

// Kategoriya bo‘yicha mahsulotlar (omborda borlarini chiqaradi)
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listByCategory(category) {
    const cat = (category || "").trim();
    const re = new RegExp(`^\\s*${escapeRegex(cat)}\\s*$`, "i"); // ✅ trim + case-insensitive

    return await Product.find({
        category: re,
        isActive: true,
        isDeleted: false,
        qty: { $gt: 0 },
    }).sort({ createdAt: -1 });
}

// ID bo‘yicha bitta mahsulot
async function getById(productId) {
    return await Product.findById(productId);
}

// (ixtiyoriy) DB dan kategoriyalarni olish
async function getCategories() {
    return await Product.distinct("category", { isActive: true, isDeleted: false });
}
module.exports = {
    createProduct,
    listProducts,
    getProductById,
    getProductByCode,
    listCategories,
    updateProduct,
    adjustStock,
    addSaleStats,
    deleteProduct,
    closeSale, listByCategory, getById, getCategories
};
