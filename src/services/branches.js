// src/services/branches.js
// ─────────────────────────────────────────────────────────────
// FILIALLAR — yagona manba.
//
// Qoidalar:
//   • branchId yo'q (null / undefined) bo'lgan HAR QANDAY eski yozuv "sang" ga tegishli.
//   • Sang balansi eski "balance" kalitida qoladi (ma'lumot ko'chirilmaydi),
//     boshqa filiallar "balance:<id>" kalitida saqlanadi.
//   • Bot handlerlarida joriy filial AsyncLocalStorage orqali uzatiladi
//     (runWithBranch) — shuning uchun storage / notify / hisobotlar
//     filial nomini qo'lda olib yurmaydi.
// ─────────────────────────────────────────────────────────────

const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");
require("../config"); // dotenv yuklanishi uchun

const als = new AsyncLocalStorage();

const DEFAULT_BRANCH = "sang";
const ALL = "all";

// Env o'qish — har safar (testlarda va keyin o'zgarganda to'g'ri ishlashi uchun)
function env(name, fallback = "") {
    const v = process.env[name];
    return v === undefined || v === null || String(v).trim() === "" ? fallback : String(v).trim();
}

function groupId(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    return s.startsWith("-") ? s : `-${s}`;
}

// ── Filial ro'yxati ──────────────────────────────────────
function getBranches() {
    const sangPin = env("PIN_SANG", env("BOT_PASSWORD", "1234"));
    const sangGroup = groupId(env("GROUP_CHAT_ID_SANG", env("GROUP_CHAT_ID")));

    return {
        sang: {
            id: "sang",
            name: env("BRANCH_SANG_NAME", "Totli Sang"),
            short: "Sang",
            pin: sangPin,
            groupChatId: sangGroup,
            address: env("BRANCH_SANG_ADDRESS", "Sang'sentir, Anhor minosi"),
            phone: env("BRANCH_SANG_PHONE", "+998 77 737 77 40"),
        },
        toda: {
            id: "toda",
            name: env("BRANCH_TODA_NAME", "Totli To'da"),
            short: "To'da",
            pin: env("PIN_TODA"),
            // Alohida guruh berilmasa — umumiy (Sang) guruhga ketadi, tepada nomi bilan
            groupChatId: groupId(env("GROUP_CHAT_ID_TODA", env("GROUP_CHAT_ID"))),
            address: env("BRANCH_TODA_ADDRESS", ""),
            phone: env("BRANCH_TODA_PHONE", "+998 77 737 77 40"),
        },
    };
}

function branchIds() {
    return Object.keys(getBranches());
}

// "sang" | "toda"  — noma'lum / bo'sh qiymat => sang
function normBranch(id) {
    const v = String(id || "").trim().toLowerCase();
    return getBranches()[v] ? v : DEFAULT_BRANCH;
}

function getBranch(id) {
    return getBranches()[normBranch(id)];
}

function branchName(id) {
    return getBranch(id).name;
}

// ── Mongo filtri ─────────────────────────────────────────
// sang  → branchId = "sang" YOKI branchId yo'q/null (eski ma'lumotlar)
// boshqa → branchId = shu id
// all   → filtr yo'q
function branchFilter(id, field = "branchId") {
    if (id === ALL) return {};
    const b = normBranch(id);
    if (b === DEFAULT_BRANCH) return { [field]: { $in: [DEFAULT_BRANCH, null] } }; // null → maydon yo'qligini ham ushlaydi
    return { [field]: b };
}

// Mavjud query ga filial shartini qo'shadi (query ni o'zgartirmaydi)
function withBranch(query, id) {
    return { ...(query || {}), ...branchFilter(id) };
}

// Aggregate $match uchun ham xuddi shu
function matchBranch(match, id) {
    return withBranch(match, id);
}

// Hujjat shu filialga tegishlimi? (JS tomonda)
function sameBranch(docBranchId, id) {
    return normBranch(docBranchId) === normBranch(id);
}

// ── Balans kaliti ────────────────────────────────────────
function balanceKey(id) {
    const b = normBranch(id);
    return b === DEFAULT_BRANCH ? "balance" : `balance:${b}`;
}

function allBalanceKeys() {
    return branchIds().map(balanceKey);
}

// ── Joriy filial konteksti (bot handler ichida) ──────────
function runWithBranch(branchId, fn) {
    return als.run({ branchId: normBranch(branchId) }, fn);
}

function currentBranch() {
    return als.getStore()?.branchId || DEFAULT_BRANCH;
}

// Login paytida bir handler ichida filial almashsa
function setCurrentBranch(branchId) {
    const st = als.getStore();
    if (st) st.branchId = normBranch(branchId);
}

// ── Guruh xabari sarlavhasi ──────────────────────────────
function branchHeader(id) {
    return `🏪 <b>${escapeHtml(branchName(id))}</b>`;
}

function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function groupFor(id) {
    return getBranch(id).groupChatId || null;
}

// ── PIN ──────────────────────────────────────────────────
function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    if (x.length !== y.length) return false;
    return crypto.timingSafeEqual(x, y);
}

// PIN ga mos filial id sini qaytaradi yoki null
function branchByPin(pin) {
    const p = String(pin || "").trim();
    if (!p) return null;
    for (const b of Object.values(getBranches())) {
        if (b.pin && safeEqual(p, b.pin)) return b.id;
    }
    return null;
}

// Noto'g'ri PIN urinishlarini cheklash (brute-force)
const _fails = new Map(); // userId -> { n, until }
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000;

function pinBlockedMs(userId) {
    const f = _fails.get(String(userId));
    if (!f) return 0;
    if (f.until && f.until > Date.now()) return f.until - Date.now();
    if (f.until && f.until <= Date.now()) _fails.delete(String(userId));
    return 0;
}

function pinFailed(userId) {
    const k = String(userId);
    const f = _fails.get(k) || { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= MAX_FAILS) { f.until = Date.now() + BLOCK_MS; f.n = 0; }
    _fails.set(k, f);
    return f;
}

function pinOk(userId) {
    _fails.delete(String(userId));
}

// Server ishga tushganda sozlamani tekshiradi (faqat ogohlantirish)
function validateBranchConfig() {
    const b = getBranches();
    if (!b.toda.pin) console.warn("⚠️ [branch] PIN_TODA .env da yo'q — To'da filiali bilan kirib bo'lmaydi");
    if (b.toda.pin && b.sang.pin === b.toda.pin) {
        console.warn("⚠️ [branch] PIN_SANG va PIN_TODA bir xil! Har filial uchun alohida PIN bering");
    }
}

module.exports = {
    DEFAULT_BRANCH, ALL,
    getBranches, getBranch, branchIds, normBranch, branchName,
    branchFilter, withBranch, matchBranch, sameBranch,
    balanceKey, allBalanceKeys,
    runWithBranch, currentBranch, setCurrentBranch,
    branchHeader, groupFor,
    branchByPin, pinBlockedMs, pinFailed, pinOk,
    validateBranchConfig,
};
