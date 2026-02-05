// src/services/productWizard.js
const Product = require("../models/Product");
const { nextProductCode } = require("./productCode");
const { publishProductToChannel } = require("./productPublish");

/* ================= Draft helpers ================= */

function draftKey(userId) {
    return `prod_add:${userId}`;
}

const CATEGORY_LIST = [
    "Tortlar",
    "Sovuq ichimliklar",
    "Perojniylar",
    "Choy/Kofe",
    "Fast Food",
    "Aksessuarlar",
];

async function startProductAdd(redis, userId) {
    await redis.set(
        draftKey(userId),
        JSON.stringify({ step: "name", data: {} }),
        "EX",
        1800
    );
    return { step: "name" };
}

async function getDraft(redis, userId) {
    const s = await redis.get(draftKey(userId));
    return s ? JSON.parse(s) : null;
}

async function setDraft(redis, userId, draft) {
    await redis.set(draftKey(userId), JSON.stringify(draft), "EX", 1800);
}

async function clearDraft(redis, userId) {
    await redis.del(draftKey(userId));
}

/* ================= Utils ================= */

function toNum(text) {
    const n = Number(String(text || "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function isSkip(text) {
    return String(text || "").trim() === "-";
}

function normCategory(v) {
    const s = String(v || "").replace(/^📁\s*/i, "").trim();
    return (s || "boshqa").toLowerCase();
}

function pickCategoryFromText(text) {
    const t = String(text || "").replace(/^📁\s*/i, "").trim().toLowerCase();
    const found = CATEGORY_LIST.find((c) => c.toLowerCase() === t);
    return found ? found.toLowerCase() : null;
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function buildPreviewText(d) {
    const name = escapeHtml(d.data.name || "-");
    const cat = escapeHtml(d.data.category || "-");
    const sale = d.data.salePrice ? `${d.data.salePrice} so'm` : "-";
    const cost = d.data.costPrice ? `${d.data.costPrice} so'm` : "0";
    const qty = (d.data.qty ?? 0);
    const desc = d.data.desc ? escapeHtml(d.data.desc) : "";

    return (
        `🧾 <b>Yangi mahsulot (tekshirish)</b>\n\n` +
        `🍰 <b>Nomi:</b> ${name}\n` +
        `📁 <b>Kategoriya:</b> ${cat}\n` +
        `💰 <b>Sotish narxi:</b> ${sale}\n` +
        `📦 <b>Kelgan narx:</b> ${cost}\n` +
        `📦 <b>Miqdor:</b> ${qty}\n` +
        (desc ? `📝 <b>Izoh:</b> ${desc}\n` : "") +
        `\n✅ Hammasi to‘g‘rimi?`
    );
}

function confirmKb() {
    return {
        inline_keyboard: [
            [{ text: "✅ Saqlash", callback_data: "prod_save" }],
            [{ text: "❌ Bekor qilish", callback_data: "prod_cancel" }],
        ],
    };
}

/* ================= Main wizard handler ================= */

async function handleWizardInput({ bot, redis, msg, userId, chatId }) {
    const d = await getDraft(redis, userId);
    if (!d) return false;

    const text = String(msg.text || "").trim();

    /* ================= PHOTO STEP ================= */
    if (d.step === "photo") {
        let tgFileId = null;
        let url = null;

        // user '-' yuborsa
        if (msg.text && isSkip(text)) {
            tgFileId = null;
            url = null;
        } else if (msg.photo && msg.photo.length) {
            tgFileId = msg.photo[msg.photo.length - 1].file_id;

            // tokenli telegram link (ixtiyoriy)
            try {
                url = await bot.getFileLink(tgFileId);
            } catch {
                url = null;
            }
        } else {
            await bot.sendMessage(
                chatId,
                "📸 Rasm yuboring (ixtiyoriy) yoki rasm bo‘lmasa '-' yuboring."
            );
            return true;
        }

        // ✅ endi DB ga yozmaymiz, draftga saqlaymiz va tasdiqlash preview chiqaramiz
        d.data.photo = { tgFileId, url };
        d.step = "confirm";
        await setDraft(redis, userId, d);

        const previewText = buildPreviewText(d);

        if (tgFileId) {
            await bot.sendPhoto(chatId, tgFileId, {
                caption: previewText,
                parse_mode: "HTML",
                reply_markup: confirmKb(),
            });
        } else {
            await bot.sendMessage(chatId, previewText, {
                parse_mode: "HTML",
                reply_markup: confirmKb(),
            });
        }

        return true;
    }

    // confirm step’da oddiy textlarni qabul qilmaymiz
    if (d.step === "confirm") {
        await bot.sendMessage(chatId, "⬇️ Pastdagi tugmadan tanlang: ✅ Saqlash yoki ❌ Bekor qilish");
        return true;
    }

    // Photo bo‘lmagan step’larda text bo‘lishi kerak
    if (!text) return true;

    /* ================= NAME STEP ================= */
    if (d.step === "name") {
        if (text.length < 2) {
            await bot.sendMessage(chatId, "❌ Nomi noto‘g‘ri. Qayta yozing (masalan: Napoleon)");
            return true;
        }

        d.data.name = text;
        d.step = "category";
        await setDraft(redis, userId, d);

        const kb = CATEGORY_LIST.map((c) => [{ text: `📁 ${c}` }]);
        kb.push([{ text: "❌ Bekor" }]);

        await bot.sendMessage(chatId, "📁 Kategoriyani tanlang:", {
            reply_markup: {
                keyboard: kb,
                resize_keyboard: true,
                one_time_keyboard: true,
            },
        });

        return true;
    }

    /* ================= CATEGORY STEP ================= */
    if (d.step === "category") {
        const picked = pickCategoryFromText(text);
        const cat = picked || normCategory(text);

        d.data.category = cat;
        d.step = "salePrice";
        await setDraft(redis, userId, d);

        await bot.sendMessage(chatId, "💰 Sotish narxini yozing (masalan: 120000)");
        return true;
    }

    /* ================= SALE PRICE STEP ================= */
    if (d.step === "salePrice") {
        const p = toNum(text);
        if (!p || p <= 0) {
            await bot.sendMessage(chatId, "❌ Sotish narxi noto‘g‘ri. Masalan: 120000");
            return true;
        }

        d.data.salePrice = p;
        d.step = "costPrice";
        await setDraft(redis, userId, d);

        await bot.sendMessage(chatId, "📦 Kelgan narxini yozing (ixtiyoriy). O‘tkazish uchun 0 yuboring.");
        return true;
    }

    /* ================= COST PRICE STEP ================= */
    if (d.step === "costPrice") {
        const p = toNum(text);
        d.data.costPrice = Math.max(0, p);

        d.step = "qty";
        await setDraft(redis, userId, d);

        await bot.sendMessage(chatId, "📦 Miqdorini yozing (masalan: 10)");
        return true;
    }

    /* ================= QTY STEP ================= */
    if (d.step === "qty") {
        const q = Math.trunc(toNum(text));
        if (q < 0) {
            await bot.sendMessage(chatId, "❌ QTY noto‘g‘ri. Masalan: 10");
            return true;
        }

        d.data.qty = q;
        d.step = "desc";
        await setDraft(redis, userId, d);

        await bot.sendMessage(chatId, "📝 Izoh yozing (ixtiyoriy). O‘tkazish uchun '-' yuboring.");
        return true;
    }

    /* ================= DESC STEP ================= */
    if (d.step === "desc") {
        d.data.desc = isSkip(text) ? "" : text;

        d.step = "photo";
        await setDraft(redis, userId, d);

        await bot.sendMessage(chatId, "📸 Endi rasm yuboring (ixtiyoriy).\nRasm bo‘lmasa '-' yuboring.");
        return true;
    }

    return false;
}

/* ================= CALLBACK (✅ Save / ❌ Cancel) ================= */

async function handleWizardCallback({
    bot,
    redis,
    q,
    userId,
    chatId,
    channelId,
    getUserName,
    catalogKeyboard, // onMessage.js dan beramiz
}) {
    const data = q.data || "";
    if (data !== "prod_save" && data !== "prod_cancel") return false;

    const d = await getDraft(redis, userId);
    if (!d) {
        try { await bot.answerCallbackQuery(q.id, { text: "Draft topilmadi" }); } catch { }
        return true;
    }

    if (data === "prod_cancel") {
        await clearDraft(redis, userId);
        try { await bot.answerCallbackQuery(q.id, { text: "Bekor qilindi" }); } catch { }
        await bot.sendMessage(chatId, "🧁 Katalog menyu:", { reply_markup: catalogKeyboard() });
        return true;
    }

    // ✅ SAVE
    if (d.step !== "confirm") {
        try { await bot.answerCallbackQuery(q.id, { text: "Avval rasm yuboring" }); } catch { }
        return true;
    }

    let productDoc = null;
    const session = await Product.startSession();

    try {
        await session.withTransaction(async () => {
            const code = await nextProductCode(session);

            productDoc = (await Product.create([{
                code,
                name: d.data.name,
                category: d.data.category,
                salePrice: d.data.salePrice,
                costPrice: d.data.costPrice,
                qty: d.data.qty,
                desc: d.data.desc || "",
                photo: {
                    tgFileId: d.data.photo?.tgFileId || null,
                    url: d.data.photo?.url || null
                },
                createdBy: { tgId: userId, tgName: getUserName({ from: { id: userId } }) },
                stats: { soldQty: 0, revenue: 0 },
                isActive: true,
                isDeleted: false,
            }], { session }))[0];
        });
    } finally {
        try { session.endSession(); } catch { }
    }

    await clearDraft(redis, userId);

    // kanal/guruhga post
    try {
        if (channelId) {
            const sent = await publishProductToChannel(bot, channelId, productDoc);

            // ✅ post id ni productga saqlab qo'yamiz
            await Product.updateOne(
                { _id: productDoc._id },
                { $set: { channelPost: { chatId: channelId, messageId: sent.message_id } } }
            );
        }
    } catch (e) {
        await bot.sendMessage(chatId, `⚠️ Kanalga yuborilmadi: ${e.message}`);
    }

    try { await bot.answerCallbackQuery(q.id, { text: "Saqlandi ✅" }); } catch { }

    await bot.sendMessage(
        chatId,
        `✅ Saqlandi!\n🧾 Kod: <b>${productDoc.code}</b>\n🍰 Nomi: <b>${escapeHtml(productDoc.name)}</b>`,
        { parse_mode: "HTML" }
    );

    // ✅ oxirida katalog menyuni ochamiz
    await bot.sendMessage(chatId, "🧁 Katalog menyu:", { reply_markup: catalogKeyboard() });

    return true;
}

// ================= LIST PRODUCTS =================
async function listProducts({ limit = 20, page = 1, category = null } = {}) {
    const q = { isDeleted: false };
    if (category) q.category = String(category).toLowerCase();

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        Product.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Product.countDocuments(q),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
}
// ================= LIST CATEGORIES =================
async function listCategories() {
    // faqat bor kategoriyalar
    const cats = await Product.distinct("category", { isDeleted: false });
    // chiroyli tartib
    return (cats || []).filter(Boolean).sort();
}

// ================= SOFT DELETE =================
async function softDeleteProductById(id) {
    const doc = await Product.findOneAndUpdate(
        { _id: id },
        { $set: { isDeleted: true, isActive: false } },
        { new: true }
    );
    if (!doc) throw new Error("Mahsulot topilmadi");
    return doc;
}

module.exports = {
    startProductAdd,
    handleWizardInput,
    handleWizardCallback,
    getDraft,
    setDraft,
    clearDraft,

    listProducts,
    listCategories,
    softDeleteProductById,
};
