// src/logic/saleDraft.js
const { redis } = require("../services/auth");

const SALE_TEMPLATE_ITEMS = {
    tortlar: [
        { name: "Tort Shekoladniy", price: 100000 },
        { name: "Tort Rafaelo", price: 125000 },
        { name: "Tort Shekoladniy mini", price: 110000 },
        { name: "Tort Maxroviy", price: 140000 },
        { name: "Tort Damashniy", price: 120000 },
        { name: "Tort mini", price: 120000 },
        { name: "Tort to'rt burchakli", price: 100000 },
        { name: "Tort Bonjur", price: 100000 },
        { name: "Bento", price: 70000 },
    ],
    perojniylar: [
        { name: "Vishnoviy", price: 20000 },
        { name: "Festashka", price: 15000 },
        { name: "Tvarojniy", price: 15000 },
        { name: "Amerikano", price: 20000 },
        { name: "Snickers", price: 17000 },
        { name: "Shekoladniy", price: 12000 },
        { name: "Meringoviy", price: 20000 },
        { name: "Shoxona", price: 18000 },
        { name: "Yurakchali", price: 17000 },
    ],
    ichimliklar: [
        { name: "Kofe", price: 5000 },
        { name: "Kofe st kichik", price: 5000 },
        { name: "Kofe st katta", price: 8000 },
        { name: "Pepsi", price: 18000 },
        { name: "Coca Cola", price: 18000 },
        { name: "Fanta", price: 18000 },
        { name: "Annar Bazaleti", price: 15000 },
        { name: "Cok", price: 15000 },
        { name: "Micko", price: 8000 },
        { name: "Adrenalin", price: 15000 },
        { name: "Limon", price: 8000 },
        { name: "Milck", price: 8000 },
    ],
    aks: [
        { name: "Sham", price: 5000 },
        { name: "Bijilag", price: 5000 },
        { name: "Toper", price: 15000 },
        { name: "Xlapushka", price: 15000 },
        { name: "Shapkacha", price: 15000 },
    ],
};

function draftKey(userId) {
    return `sale_draft:${userId}`;
}

function categoryKey(userId) {
    return `sale_tpl_cat:${userId}`;
}

function flattenItems() {
    return Object.values(SALE_TEMPLATE_ITEMS).flat();
}

function findTemplateItem(name) {
    return flattenItems().find((x) => x.name === name);
}

async function getSaleDraft(userId) {
    const raw = await redis.get(draftKey(userId));
    if (!raw) return [];

    try {
        const data = JSON.parse(raw);
        return Array.isArray(data.items) ? data.items : [];
    } catch {
        return [];
    }
}

async function saveSaleDraft(userId, items) {
    await redis.set(draftKey(userId), JSON.stringify({ items }), "EX", 60 * 60);
}

async function addSaleDraftItem(userId, itemName) {
    const items = await getSaleDraft(userId);
    const tpl = findTemplateItem(itemName);
    const basePrice = Number(tpl?.price || 0);

    const existing = items.find((x) => x.name === itemName);

    if (existing) {
        existing.qty = Number(existing.qty || 1) + 1;

        // unitPrice ASLO o‘zgarmaydi
        if (!existing.unitPrice || Number(existing.unitPrice) <= 0) {
            existing.unitPrice = basePrice;
        }
    } else {
        items.push({
            name: itemName,
            qty: 1,
            unitPrice: basePrice,
        });
    }

    await saveSaleDraft(userId, items);
    return items;
}

async function clearSaleDraft(userId) {
    await redis.del(draftKey(userId));
}

async function getSaleTemplateCategory(userId) {
    const cat = await redis.get(categoryKey(userId));
    return cat || "tortlar";
}

async function setSaleTemplateCategory(userId, category) {
    await redis.set(categoryKey(userId), category, "EX", 60 * 60);
}

function buildSaleDraftTextFromItems(items = []) {
    return items
        .map((item) => {
            const qty = Number(item.qty || 1);
            const unitPrice = Number(item.unitPrice || 0);

            if (unitPrice > 0) {
                if (qty <= 1) {
                    return `${item.name} ${unitPrice}`;
                }

                return `${item.name} ${qty}ta ${unitPrice}`;
            }

            if (qty <= 1) return item.name;

            return `${item.name} ${qty}ta`;
        })
        .join(", ");
}

async function buildSaleDraftText(userId) {
    const items = await getSaleDraft(userId);
    return buildSaleDraftTextFromItems(items);
}

module.exports = {
    SALE_TEMPLATE_ITEMS,
    getSaleDraft,
    addSaleDraftItem,
    clearSaleDraft,
    buildSaleDraftText,
    getSaleTemplateCategory,
    setSaleTemplateCategory,
};