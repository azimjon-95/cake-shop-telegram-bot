// DB saqlash chegarasidagi idempotentlik: bir xil idemKey → bitta yozuv, balans bir marta o'zgaradi
process.env.BOT_TOKEN = "123456789:AAH-testtokentesttokentesttoken12345";
process.env.OPENAI_API_KEY = "sk-test";
const path = require("path");
const { test, eq, ok, run } = require("./_harness");
const R = (p) => path.join(__dirname, "..", "src", p);
const stub = (p, exp) => { const f = require.resolve(R(p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };

let seq = 0;
stub("services/orderNo", { nextOrderNo: async () => "N" + (++seq) });
const { mongoose } = require(R("db"));
// Soxta tranzaksiya: xato bo'lsa barcha o'zgarishlar bekor (rollback simulyatsiyasi)
let db, staged;
const fresh = () => { db = { sales: [], expenses: [], debts: [], balance: { balance: 1000000 } }; };
mongoose.startSession = async () => ({
    async withTransaction(fn) {
        staged = JSON.parse(JSON.stringify(db));
        try { await fn(); } catch (e) { db = staged; throw e; }
    },
    endSession() { },
});
const q = (v) => { const t = { lean: async () => v, then: (r, j) => Promise.resolve(v).then(r, j) }; return { session: () => t, ...t }; };
const Sale = require(R("models/Sale")), Expense = require(R("models/Expense")), Debt = require(R("models/Debt")), Counter = require(R("models/Counter"));
let raceDup = false;
Sale.findOne = (f) => q(raceDup ? null : db.sales.find(s => s.idemKey === f.idemKey) || null);
Sale.create = async ([d]) => {
    if (d.idemKey && db.sales.some(s => s.idemKey === d.idemKey)) { const e = new Error("E11000 duplicate key"); e.code = 11000; throw e; }
    const s = { ...d, _id: "s" + db.sales.length }; db.sales.push(s); return [s];
};
Expense.findOne = (f) => q(db.expenses.find(s => s.idemKey === f.idemKey) || null);
Expense.create = async (arg) => {
    const d = Array.isArray(arg) ? arg[0] : arg;
    if (d.idemKey && db.expenses.some(s => s.idemKey === d.idemKey)) { const e = new Error("E11000"); e.code = 11000; throw e; }
    const x = { ...d, _id: "e" + db.expenses.length }; db.expenses.push(x); return Array.isArray(arg) ? [x] : x;
};
Debt.create = async ([d]) => { db.debts.push(d); return [d]; };
Counter.findOneAndUpdate = async (f, u) => { db.balance[f.key] = (db.balance[f.key] || 0) + u.$inc.value; return { value: db.balance[f.key] }; };
Counter.findOne = (f) => q({ value: db.balance[f.key] || 0 });

const storage = require(R("logic/storage"));
const seller = { tgId: 1, tgName: "S" };
const items = [{ name: "Tort", qty: 1, price: 140000, paid: 140000 }];

test("sotuv: bir xil idemKey ikkinchi marta → DUPLICATE_OPERATION, balans bir marta", async () => {
    fresh();
    await storage.saveSaleWithTx({ seller, items, idemKey: "voice:1:10" });
    let code; try { await storage.saveSaleWithTx({ seller, items, idemKey: "voice:1:10" }); } catch (e) { code = e.code; ok(e.existing?.orderNo, "existing"); }
    eq([code, db.sales.length, db.balance.balance], ["DUPLICATE_OPERATION", 1, 1140000]);
});
test("sotuv: poyga (findOne ko'rmadi, unique index E11000) → DUPLICATE, balans rollback", async () => {
    fresh(); await storage.saveSaleWithTx({ seller, items, idemKey: "voice:1:11" });
    raceDup = true; let code; try { await storage.saveSaleWithTx({ seller, items, idemKey: "voice:1:11" }); } catch (e) { code = e.code; } raceDup = false;
    eq([code, db.sales.length, db.balance.balance], ["DUPLICATE_OPERATION", 1, 1140000]);
});
test("sotuv: idemKey yo'q (matnli sotuv) — eski xatti-harakat, ikki sotuv", async () => {
    fresh(); await storage.saveSaleWithTx({ seller, items }); await storage.saveSaleWithTx({ seller, items });
    eq([db.sales.length, db.balance.balance], [2, 1280000]); ok(!("idemKey" in db.sales[0]), "idemKey maydoni yozilmaydi");
});
test("chiqim: bir xil idemKey → bitta chiqim, balans bir marta kamayadi", async () => {
    fresh();
    await storage.saveExpenseWithTx({ spender: seller, title: "Taksi", amount: 25000, categoryKey: "taxi", idemKey: "voice:1:12" });
    let code; try { await storage.saveExpenseWithTx({ spender: seller, title: "Taksi", amount: 25000, categoryKey: "taxi", idemKey: "voice:1:12" }); } catch (e) { code = e.code; }
    eq([code, db.expenses.length, db.balance.balance], ["DUPLICATE_OPERATION", 1, 975000]);
});
test("chiqim: balans yetmasa BALANCE_LOW (mavjud qoida o'zgarmagan)", async () => {
    fresh(); db.balance.balance = 100; let m; try { await storage.saveExpenseWithTx({ spender: seller, title: "x", amount: 5000 }); } catch (e) { m = e.message; }
    eq(m, "BALANCE_LOW:100");
});
test("sotuv hisob-kitobi o'zgarmagan: qarz va qaytim", async () => {
    fresh(); const r = await storage.saveSaleWithTx({ seller, items: [{ name: "Tort", qty: 2, price: 100000, paid: 150000 }], idemKey: "voice:1:13" });
    eq([r.sale.total, r.sale.paidTotal, r.sale.debtTotal, db.debts.length], [200000, 150000, 50000, 1]);
});

// saleMessage: takror bo'lsa "allaqachon saqlangan", guruhga/print'ga qayta ketmaydi
test("processSaleInput: DUPLICATE → foydalanuvchiga xabar, guruhga yuborilmaydi", async () => {
    fresh(); const sent = [];
    const group = []; const notify = require(R("services/notify")); notify.sendToGroup = async (_b, t) => group.push(t);
    const { processSaleInput } = require(R("handlers/message/saleMessage"));
    const bot = { sendMessage: async (c, t) => { sent.push(t); return { message_id: 1 }; } };
    await storage.saveSaleWithTx({ seller, items, idemKey: "voice:1:14" });
    const r = await processSaleInput(bot, { chat: { id: 1 } }, "Tort 140000", seller, { tryAI: false, idemKey: "voice:1:14" });
    eq(r, false); ok(sent.join().includes("allaqachon saqlangan")); eq(db.sales.length, 1);
});

run("IDEMPOTENCY (DB chegarasi)");
