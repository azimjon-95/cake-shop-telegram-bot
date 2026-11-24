// Integratsiya testlari: voice router → (STT stub) → AI (client stub) → tekshiruv → mavjud servislar (stub, yozuvlari sanaladi)
process.env.BOT_TOKEN = "123456789:AAH-testtokentesttokentesttoken12345";
process.env.OPENAI_API_KEY = "sk-test-int";
process.env.VOICE_MAX_RETRIES = "0";
const path = require("path");
const { test, eq, ok, sleep, run } = require("./_harness");

const R = (p) => path.join(__dirname, "..", "src", p);
const stub = (p, exp) => { const f = require.resolve(R(p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };

// ── Stublar (router yuklanishidan OLDIN) ──
let spoken = "tort 140 ming", sttDelay = 0, sttCalls = 0, sttError = null;
stub("services/stt", { transcribeTelegramVoice: async (_b, _f, o) => { sttCalls++; o.timings.stt = 1; if (sttDelay) await sleep(sttDelay); if (sttError) throw sttError; return spoken; } });
const sales = [], expenses = [], suppliers = [], groupMsgs = [];
stub("handlers/message/saleMessage", { processSaleInput: async (_b, _m, text, seller, o) => { sales.push({ text, seller: seller.tgId, tryAI: o?.tryAI }); return true; } });
const { currentBranch } = require(R("services/branches"));
stub("handlers/expenseFlow", { REQUIRED_DESCRIPTION_CATEGORIES: new Set(["other", "repair", "bank"]), startSupplierPickWithAmount: async (_b, _c, s, a) => suppliers.push({ s: s.tgId, a }) });
let balanceLow = false;
stub("logic/storage", { saveExpenseWithTx: async (d) => { if (balanceLow) throw new Error("BALANCE_LOW:1000"); expenses.push({ ...d, branch: currentBranch() }); return { _id: "e" + expenses.length, orderNo: "N" + expenses.length }; }, saveSaleWithTx: async () => { throw new Error("tegilmasligi kerak"); } });
stub("services/notify", { sendToGroup: async (_b, t) => groupMsgs.push(t) });

const { openai } = require(R("services/openai"));
const auth = require(R("services/auth"));
const { routeVoiceMessage, confirmVoicePending } = require(R("handlers/message/voiceRouter"));

let aiReply = "Tort 140000", aiFail = null, aiCalls = 0;
openai.chat.completions.create = async () => { aiCalls++; if (aiFail) throw aiFail; return { choices: [{ message: { content: aiReply } }] }; };

let mid = 1000;
const mkBot = () => { const log = []; let n = 0; return { log, sendMessage: async (c, t, o) => { log.push({ k: "send", c, t, o }); return { message_id: ++n }; }, editMessageText: async (t, o) => { log.push({ k: "edit", t, o }); return {}; }, editMessageReplyMarkup: async () => ({}), deleteMessage: async () => ({}) }; };
const mkMsg = (uid, extra = {}) => ({ chat: { id: uid }, from: { id: uid, first_name: "T" }, message_id: ++mid, voice: { file_id: "f" + mid, file_unique_id: "u" + mid, duration: 5, mime_type: "audio/ogg", file_size: 5000, ...(extra.voice || {}) }, ...extra.msg });
const texts = (bot) => bot.log.map(x => x.t).join("\n---\n");
const reset = () => { spoken = "tort 140 ming"; aiReply = "Tort 140000"; aiFail = null; sttDelay = 0; sttError = null; balanceLow = false; sales.length = expenses.length = suppliers.length = groupMsgs.length = 0; sttCalls = aiCalls = 0; };
let uidSeq = 5000; const nu = () => ++uidSeq;
const confirmQ = (bot, uid, mId) => ({ message: { chat: { id: uid }, message_id: mId }, from: { id: uid } });
const lastButtons = (bot) => [...bot.log].reverse().find(x => x.o?.reply_markup?.inline_keyboard)?.o.reply_markup.inline_keyboard[0];

// ── SOTUV ──
test("voice → STT → AI → tekshiruv → mavjud sotuv oqimi (1 marta, tryAI:false)", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "tort sotildi 140ming ga shap 2 ta 5 minga"; aiReply = "Tort 140000, Sham 2ta 5000";
    await routeVoiceMessage(b, mkMsg(u));
    eq(sales, [{ text: "Tort 140000, Sham 2ta 5000", seller: u, tryAI: false }]); eq(aiCalls, 1);
});
test("sotuvga aloqasi yo'q gap → AI ham chaqirilmaydi, saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "bugun havo juda yaxshi ekan"; await routeVoiceMessage(b, mkMsg(u));
    eq([sales.length, aiCalls], [0, 0]); ok(texts(b).includes("sotuv emas"));
});
test("AI 'NO' desa → saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "salom 5 ta odam keldi"; aiReply = "NO"; await routeVoiceMessage(b, mkMsg(u));
    eq(sales.length, 0); ok(texts(b).includes("aniqlanmadi"));
});
test("AI ishlamaydi (503) → zahira: ishonchli parse bo'lsa saqlanadi", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "Tort 140000, Sham 2ta 5000"; aiFail = Object.assign(new Error("x"), { status: 503 });
    await routeVoiceMessage(b, mkMsg(u)); eq(sales.map(s => s.text), ["Tort 140000, Sham 2ta 5000"]);
});
test("AI ishlamaydi + zahira ham o'qiy olmaydi → saqlanmaydi, tushunarli xabar", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "tort yuz qirq ming"; aiFail = Object.assign(new Error("x"), { status: 429, code: "insufficient_quota" });
    await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 0); ok(texts(b).includes("matn orqali"), texts(b));
});
test("AI ishlamaydi + zahira parse qildi, lekin shubhali → tasdiq so'raydi (avtomatik saqlamaydi)", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "Tort 140000 Sham 2ta 90000000"; aiFail = new Error("net"); aiFail.status = 500;
    await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 0); ok(lastButtons(b)?.[0].callback_data === "vsale_ok");
});
test("AI noto'g'ri narx qaytardi (14000 vs 140 ming) → tasdiq; tasdiqlansa 1 marta saqlanadi; ikkinchi bosish — yo'q", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "tort 140 ming"; aiReply = "Tort 14000";
    const m = mkMsg(u); await routeVoiceMessage(b, m); eq(sales.length, 0); ok(lastButtons(b)?.[0].callback_data === "vsale_ok");
    const q = confirmQ(b, u, 777); const seller = { tgId: u, tgName: "T" };
    await Promise.all([confirmVoicePending(b, q, seller, "sale", true), confirmVoicePending(b, q, seller, "sale", true)]);
    eq(sales.length, 1, "faqat bitta"); eq(sales[0].text, "Tort 14000");
});
test("bekor tugmasi → saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); aiReply = "Tort 14000"; await routeVoiceMessage(b, mkMsg(u));
    await confirmVoicePending(b, confirmQ(b, u, 778), { tgId: u }, "sale", false); eq(sales.length, 0);
});
test("jami summa aytilganda (2 ta tort jami 240 ming) → avtomatik, tasdiqsiz", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "2 ta tort jami 240 ming"; aiReply = "Tort 2ta 120000"; await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 1);
});
test("ruscha nutq: 'торт сто сорок тысяч' → avtomatik", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "торт сто сорок тысяч"; aiReply = "Tort 140000"; await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 1);
});
test("AI sxemadan tashqari chiqish (izoh/markdown) → saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); aiReply = "Mana natija:\n**Tort 140000**"; await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 0);
});

// ── Idempotentlik / concurrency / validatsiya / rejimlar ──
test("takroriy Telegram update → faqat bitta operatsiya", async () => {
    reset(); const u = nu(), b = mkBot(); const m = mkMsg(u); aiReply = "Tort 140000";
    await Promise.all([routeVoiceMessage(b, m), routeVoiceMessage(b, m), routeVoiceMessage(b, m)]);
    eq([sales.length, sttCalls], [1, 1]);
});
test("bir user: parallel ovoz limiti (1) — ikkinchisi rad, tugagach yana mumkin", async () => {
    reset(); const u = nu(), b = mkBot(); sttDelay = 150;
    await Promise.all([routeVoiceMessage(b, mkMsg(u)), (async () => { await sleep(30); await routeVoiceMessage(b, mkMsg(u)); })()]);
    eq(sales.length, 1); ok(texts(b).includes("Oldingi ovoz"));
    sttDelay = 0; await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 2, "slot bo'shagach ishlaydi");
});
test("turli userlar parallel ishlaydi", async () => {
    reset(); sttDelay = 80; const us = [nu(), nu(), nu()];
    await Promise.all(us.map(u => routeVoiceMessage(mkBot(), mkMsg(u)))); eq(sales.length, 3);
});
test("slot xatoda ham bo'shatiladi", async () => {
    reset(); const u = nu(), b = mkBot(); sttError = Object.assign(new Error("x"), { code: "STT_FAILED" });
    await routeVoiceMessage(b, mkMsg(u)); sttError = null; await routeVoiceMessage(b, mkMsg(u)); eq(sales.length, 1);
});
test("duration/size/mime rad etiladi — STT chaqirilmaydi", async () => {
    reset(); const u = nu(), b = mkBot();
    await routeVoiceMessage(b, mkMsg(u, { voice: { duration: 0 } })); await routeVoiceMessage(b, mkMsg(u, { voice: { duration: 99 } }));
    await routeVoiceMessage(b, mkMsg(u, { voice: { file_size: 99 * 1024 * 1024 } })); await routeVoiceMessage(b, mkMsg(u, { voice: { mime_type: "video/mp4" } }));
    eq([sttCalls, sales.length], [0, 0]);
});
test("voice yo'q bo'lsa pipeline ishlamaydi", async () => { reset(); const b = mkBot(); await routeVoiceMessage(b, { chat: { id: 1 }, from: { id: 1 }, message_id: 1 }); eq([sttCalls, b.log.length], [0, 0]); });
test("STRUCTURED mode va ochiq boshqa oqim — ovoz qabul qilinmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); await auth.setMode(u, "await_password"); await routeVoiceMessage(b, mkMsg(u)); ok(texts(b).includes("matn bilan"));
    await auth.setMode(u, "sale"); await auth.redis.set(`pur_state:${u}`, "{}", "EX", 60); await routeVoiceMessage(b, mkMsg(u)); eq([sales.length, sttCalls], [0, 0]);
    await auth.redis.del(`pur_state:${u}`);
});
test("HTML: eshitilgan matndagi teg escape qilinadi", async () => {
    reset(); const u = nu(), b = mkBot(); spoken = "<b>hack</b> tort 140 ming"; aiReply = "Tort 140000"; await routeVoiceMessage(b, mkMsg(u));
    ok(!texts(b).includes("<b>hack</b>") && texts(b).includes("&lt;b&gt;hack"), texts(b));
});

// ── CHIQIM ──
const inExpense = async (u) => auth.redis.set(`exp_state:${u}`, JSON.stringify({ step: "pick_category" }), "EX", 60);
test("chiqim: voice → AI JSON → tekshiruv → saveExpenseWithTx (kategoriya mavjud kalitga)", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); spoken = "elektr uchun sakson ming"; aiReply = '{"categoryKey":"electricity","amount":80000,"description":""}';
    await routeVoiceMessage(b, mkMsg(u));
    eq(expenses.length, 1); eq([expenses[0].categoryKey, expenses[0].amount], ["electric", 80000]); ok(groupMsgs.length === 1);
    ok(texts(b).includes("Chiqim saqlandi"));
});
test("chiqim: AI ishlamasa SAQLANMAYDI, tushunarli xato", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); aiFail = Object.assign(new Error("x"), { status: 503 });
    await routeVoiceMessage(b, mkMsg(u)); eq(expenses.length, 0); ok(/qayta|matn/i.test(texts(b)), texts(b));
});
test("chiqim: AI JSON emas/sxemadan tashqari → saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); aiReply = '```json\n{"categoryKey":"taxi","amount":1000,"description":""}\n```';
    await routeVoiceMessage(b, mkMsg(u)); eq(expenses.length, 0);
});
test("chiqim: summa gapda yo'q → tasdiq; tasdiqlansa 1 marta; ikki marta bosish — bitta", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); spoken = "taksiga yigirma besh ming"; aiReply = '{"categoryKey":"taxi","amount":250000,"description":""}';
    await routeVoiceMessage(b, mkMsg(u)); eq(expenses.length, 0); ok(lastButtons(b)?.[0].callback_data === "vexp_ok");
    const q = confirmQ(b, u, 888), s = { tgId: u, tgName: "T" };
    await Promise.all([confirmVoicePending(b, q, s, "expense", true), confirmVoicePending(b, q, s, "expense", true)]); eq(expenses.length, 1);
});
test("chiqim: tavsif majburiy (repair, tavsifsiz) → holat saqlanadi, saqlanmaydi", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); spoken = "ustaga yuz ming"; aiReply = '{"categoryKey":"repair","amount":100000,"description":""}';
    await routeVoiceMessage(b, mkMsg(u)); eq(expenses.length, 0);
    const st = JSON.parse(await auth.redis.get(`exp_state:${u}`)); eq([st.step, st.categoryKey, st.amount], ["desc", "master", 100000]);
});
test("chiqim: firma → mavjud supplier tanlash oqimi (summa bilan)", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); spoken = "taminotga uch yuz ming"; aiReply = '{"categoryKey":"supplier","amount":300000,"description":"un"}';
    await routeVoiceMessage(b, mkMsg(u)); eq(expenses.length, 0); eq(suppliers, [{ s: u, a: 300000 }]);
});
test("chiqim: balans yetmasa 'saqlandi' DEMAYDI", async () => {
    reset(); const u = nu(), b = mkBot(); await inExpense(u); balanceLow = true; spoken = "taksiga yigirma besh ming"; aiReply = '{"categoryKey":"taxi","amount":25000,"description":""}';
    await routeVoiceMessage(b, mkMsg(u)); ok(!texts(b).includes("Chiqim saqlandi") && texts(b).includes("Balans yetarli emas"), texts(b));
});
test("filial izolyatsiyasi: A filial foydalanuvchisi saqlashi A kontekstida (parallel B bilan aralashmaydi)", async () => {
    reset(); const { runWithBranch } = require(R("services/branches")); const ua = nu(), ub = nu(); await inExpense(ua); await inExpense(ub);
    spoken = "taksiga yigirma besh ming"; aiReply = '{"categoryKey":"taxi","amount":25000,"description":""}'; sttDelay = 20;
    await Promise.all([runWithBranch("sang", () => routeVoiceMessage(mkBot(), mkMsg(ua))), runWithBranch("toda", () => routeVoiceMessage(mkBot(), mkMsg(ub)))]);
    eq(expenses.map(e => e.branch).sort(), ["sang", "toda"]);
});
test("chiqim AI: xabar tahrirlash xatosi bo'lsa ham fallback xabar yuboriladi", async () => {
    reset(); const u = nu(), b = mkBot(); b.editMessageText = async () => { throw new Error("message can't be edited"); }; await routeVoiceMessage(b, mkMsg(u));
    eq(sales.length, 1); ok(b.log.filter(x => x.k === "send").length >= 2);
});

run("VOICE INTEGRATION");
