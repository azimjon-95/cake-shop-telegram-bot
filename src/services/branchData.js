// src/services/branchData.js
// Filial bo'yicha hisob-kitob yordamchilari (balans, firma qarzi, qarzdor mijozlar yig'indisi)

const Counter = require("../models/Counter");
const Supplier = require("../models/Supplier");
const { ALL, DEFAULT_BRANCH, normBranch, balanceKey, allBalanceKeys, branchIds } = require("./branches");

// ── Balans ───────────────────────────────────────────────
// id = "sang" | "toda" | "all"
async function balanceFor(id, session) {
    if (id === ALL) {
        const docs = await Counter.find({ key: { $in: allBalanceKeys() } }).session(session || null).lean();
        return docs.reduce((a, d) => a + Number(d.value || 0), 0);
    }
    const doc = await Counter.findOne({ key: balanceKey(id) }).session(session || null).lean();
    return Number(doc?.value || 0);
}

// ── Firma qarzi (Supplier) ───────────────────────────────
// Supplier.debt = jami; Supplier.branchDebts = sang'dan boshqa filiallar ulushi.
function otherBranchesDebt(sup) {
    const bd = sup?.branchDebts || {};
    return Object.entries(bd)
        .filter(([k]) => k !== DEFAULT_BRANCH)
        .reduce((a, [, v]) => a + Number(v || 0), 0);
}

// Bitta firmaning shu filialdagi qarzi
function supplierDebtOf(sup, id) {
    if (id === ALL) return Math.max(0, Number(sup?.debt || 0) - Number(sup?.branchDebts?.test || 0)); // TEST qarzi jamiga kirmaydi
    const b = normBranch(id);
    if (b === DEFAULT_BRANCH) return Math.max(0, Number(sup?.debt || 0) - otherBranchesDebt(sup));
    return Math.max(0, Number(sup?.branchDebts?.[b] || 0));
}

// Qarzni o'zgartiradi (delta + qo'shadi, - kamaytiradi). sup.save() chaqiruvchida.
function applySupplierDebtDelta(sup, id, delta) {
    const b = normBranch(id);
    const d = Number(delta || 0);
    const cur = supplierDebtOf(sup, b);
    const applied = d < 0 ? -Math.min(cur, -d) : d; // filial qarzidan ko'p ayirmaymiz

    sup.debt = Math.max(0, Number(sup.debt || 0) + applied);

    if (b !== DEFAULT_BRANCH) {
        const bd = { ...(sup.branchDebts || {}) };
        bd[b] = Math.max(0, Number(bd[b] || 0) + applied);
        sup.branchDebts = bd;
        if (typeof sup.markModified === "function") sup.markModified("branchDebts");
    }
    return applied;
}

// Dashboard / hisobot uchun: firmalarga jami qarz (filial bo'yicha)
async function supplierDebtSum(id) {
    const rows = await Supplier.find({ debt: { $gt: 0 } }).select("debt branchDebts").lean();
    return rows.reduce((a, s) => a + supplierDebtOf(s, id), 0);
}

module.exports = {
    balanceFor,
    supplierDebtOf,
    applySupplierDebtDelta,
    supplierDebtSum,
    otherBranchesDebt,
    branchIds,
};
