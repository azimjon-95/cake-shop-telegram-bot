// src/services/cartService.js
const carts = new Map();
const states = new Map();

/**
 * CART:
 * {
 *   items: Map(pid => {
 *     product: { _id, name, salePrice, photo },
 *     qty,
 *     soldPrice
 *   }),
 *   lastPid: string|null
 * }
 */

function getCart(chatId) {
    const key = String(chatId);
    if (!carts.has(key)) {
        carts.set(key, { items: new Map(), lastPid: null });
    }
    return carts.get(key);
}

function clearCart(chatId) {
    const key = String(chatId);
    carts.delete(key);
    states.delete(key);
}

function addToCart(chatId, product) {
    const cart = getCart(chatId);
    const pid = String(product._id);

    if (!cart.items.has(pid)) {
        cart.items.set(pid, {
            product: {
                _id: product._id,
                name: product.name,
                salePrice: product.salePrice,
                photo: product.photo || {},
            },
            qty: 1,
            soldPrice: product.salePrice,
        });
    } else {
        cart.items.get(pid).qty += 1;
    }

    cart.lastPid = pid;
    return cart;
}

function incQty(chatId, productId) {
    const cart = getCart(chatId);
    const item = cart.items.get(String(productId));
    if (item) {
        item.qty += 1;
        cart.lastPid = String(productId);
    }
    return cart;
}

function decQty(chatId, productId) {
    const cart = getCart(chatId);
    const pid = String(productId);
    const item = cart.items.get(pid);
    if (!item) return cart;

    item.qty -= 1;
    if (item.qty <= 0) cart.items.delete(pid);
    return cart;
}

function removeItem(chatId, productId) {
    const cart = getCart(chatId);
    cart.items.delete(String(productId));
    return cart;
}

function setSoldPrice(chatId, productId, newPrice) {
    const cart = getCart(chatId);
    const item = cart.items.get(String(productId));
    const p = Number(newPrice);
    if (item && Number.isFinite(p) && p > 0) item.soldPrice = p;
    return cart;
}

function setLastSoldPrice(chatId, newPrice) {
    const cart = getCart(chatId);
    const pid = cart.lastPid;
    if (!pid) return cart;

    const item = cart.items.get(String(pid));
    const p = Number(newPrice);
    if (item && Number.isFinite(p) && p > 0) item.soldPrice = p;
    return cart;
}

function listItems(chatId) {
    const cart = getCart(chatId);
    return Array.from(cart.items.values());
}

function calcTotals(chatId) {
    const items = listItems(chatId);

    let subtotalBase = 0;
    let subtotalSold = 0;

    for (const it of items) {
        subtotalBase += (it.product.salePrice || 0) * it.qty;
        subtotalSold += (it.soldPrice || 0) * it.qty;
    }

    return {
        subtotalBase,
        subtotalSold,
        discount: Math.max(0, subtotalBase - subtotalSold),
        total: subtotalSold,
    };
}

/* ===== STATE ===== */

function setState(chatId, state) {
    states.set(String(chatId), state);
}
function getState(chatId) {
    return states.get(String(chatId)) || null;
}
function clearState(chatId) {
    states.delete(String(chatId));
}

module.exports = {
    getCart,
    clearCart,
    addToCart,
    incQty,
    decQty,
    removeItem,
    setSoldPrice,
    setLastSoldPrice,
    listItems,
    calcTotals,
    setState,
    getState,
    clearState,
};
