// Regressiya: firma chiqimi oqimi (matn bilan summa) o'zgarmagan + ovozdan kelgan summa tasdig'i bir marta ishlaydi
process.env.BOT_TOKEN = "123456789:AAH-testtokentesttokentesttoken12345";
process.env.OPENAI_API_KEY = "sk-test";
const path = require("path");
const { test, eq, ok, run } = require("./_harness");
const R = (p) => path.join(__dirname, "..", "src", p);
const stub = (p, exp) => { const f = require.resolve(R(p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };

let counter = { balance: 1000000 }; const expenses = [];
stub("services/orderNo", { nextOrderNo: async () => "N" + (expenses.length + 1) });
stub("services/notify", { sendToGroup: async () => { } });
stub("keyboards", { expenseCategoryKeyboard: () => ({}), supplierListKeyboard: async () => ({ inline_keyboard: [[{ text: "F", callback_data: "exp_sup_select:s1" }]] }), mainMenuKeyboard: () => ({}) });
const Counter = require(R("models/Counter")), Expense = require(R("models/Expense")), Supplier = require(R("models/Supplier"));
Counter.findOne = () => ({ session: () => ({ then: (r) => r({ value: counter.balance }) }), lean: async () => ({ value: counter.balance }) });
Counter.findOneAndUpdate = async (f, u) => { counter.balance += u.$inc.value; return { value: counter.balance }; };
Expense.create = async (d) => { const e = { ...d, _id: "e" + (expenses.length + 1), createdAt: new Date() }; expenses.push(e); return e; };
let sup;
Supplier.findById = async () => sup;
const resetSup = () => { sup = { _id: "s1", name: "Firma", debt: 500000, branchDebts: {}, markModified() { }, async save() { } }; };

const flow = require(R("handlers/expenseFlow")), { redis } = require(R("services/auth"));
const mkBot = () => { const log = []; return { log, answerCallbackQuery: async () => { }, sendMessage: async (c, t, o) => { log.push({ t, o }); return { message_id: log.length }; }, editMessageReplyMarkup: async () => { } }; };
const seller = { tgId: 9001, tgName: "S" };
const cq = (data, mid = 1) => ({ id: "q", data, message: { chat: { id: 9001 }, message_id: mid }, from: { id: 9001 } });

test("matn bilan: firma tanlash → summa yozish → to'lov (eski oqim o'zgarmagan)", async () => {
    resetSup(); expenses.length = 0; counter.balance = 1000000; const b = mkBot();
    await flow.onExpenseCallback(b, cq("exp_cat:supplier"), seller);
    await flow.onExpenseCallback(b, cq("exp_sup_select:s1"), seller);
    ok(!b.log.some(x => String(x.t).includes("Ovozdan")), "preset yo'q");
    const done = await flow.onExpenseMessage(b, { chat: { id: 9001 }, from: { id: 9001 }, text: "200000" });
    eq(done, true); eq(expenses.length, 1); eq([expenses[0].amount, expenses[0].categoryKey], [200000, "supplier"]);
    eq([sup.debt, counter.balance], [300000, 800000]);
});
test("ovozdan summa: ro'yxat → tanlash → ✅ tugma → bir marta to'lanadi (ikki bosish)", async () => {
    resetSup(); expenses.length = 0; counter.balance = 1000000; const b = mkBot();
    await flow.startSupplierPickWithAmount(b, 9001, seller, 150000);
    const st0 = JSON.parse(await redis.get("exp_state:9001")); eq([st0.step, st0.presetAmount], ["pick_supplier", 150000]);
    await flow.onExpenseCallback(b, cq("exp_sup_select:s1"), seller);
    const btn = b.log[b.log.length - 1].o.reply_markup.inline_keyboard[0][0]; eq(btn.callback_data, "exp_sup_preset");
    await Promise.all([flow.onExpenseCallback(b, cq("exp_sup_preset", 55), seller), flow.onExpenseCallback(b, cq("exp_sup_preset", 55), seller)]);
    eq(expenses.length, 1, "bitta chiqim"); eq([expenses[0].amount, sup.debt, counter.balance], [150000, 350000, 850000]);
});
test("ovozdan summa qarzdan katta bo'lsa — qarz miqdorigacha (mavjud qoida)", async () => {
    resetSup(); expenses.length = 0; counter.balance = 1000000; const b = mkBot();
    await flow.startSupplierPickWithAmount(b, 9001, seller, 900000);
    await flow.onExpenseCallback(b, cq("exp_sup_select:s1"), seller); await flow.onExpenseCallback(b, cq("exp_sup_preset", 66), seller);
    eq([expenses[0].amount, sup.debt], [500000, 0]);
});
test("state yo'q bo'lsa preset tugma — to'lamaydi", async () => {
    resetSup(); expenses.length = 0; const b = mkBot(); await redis.del("exp_state:9001");
    await flow.onExpenseCallback(b, cq("exp_sup_preset", 77), seller); eq(expenses.length, 0);
});
run("EXPENSE SUPPLIER REGRESSION");
