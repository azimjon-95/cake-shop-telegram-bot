// End-to-end HTTP: haqiqiy OpenAI SDK → mahalliy soxta OpenAI server (multipart, parametrlar, xato statuslari, retry)
// + scripts/voice-check.js baholash rejimi. ffmpeg kerak.
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), { execFileSync, execFile } = require("child_process");
const { test, eq, ok, rejectsCode, run } = require("./_harness");
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { console.log("⚠️ ffmpeg yo'q — o'tkazildi"); process.exit(0); }

const reqs = []; let mode = "ok";
const server = http.createServer((req, res) => {
    let body = []; req.on("data", c => body.push(c)); req.on("end", () => {
        body = Buffer.concat(body); reqs.push({ url: req.url, ct: req.headers["content-type"] || "", auth: req.headers.authorization, body });
        const send = (st, obj) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
        if (req.url.startsWith("/v1/models/")) return send(200, { id: req.url.split("/").pop(), object: "model" });
        if (req.url === "/v1/audio/transcriptions") {
            if (mode === "401") return send(401, { error: { message: "Incorrect API key provided: sk-abc***xyz", code: "invalid_api_key" } });
            if (mode === "503") return send(503, { error: { message: "overloaded" } });
            return send(200, { text: mode === "ru" ? "торт сто сорок тысяч" : "tort 140 ming sham 2 ta 5 ming" });
        }
        if (req.url === "/v1/chat/completions") {
            const p = JSON.parse(body.toString());
            const sys = p.messages[0].content;
            const content = sys.includes("chiqim") ? '{"categoryKey":"taxi","amount":25000,"description":""}' : (mode === "ru" ? "Tort 140000" : "Tort 140000, Sham 2ta 5000");
            return send(200, { id: "x", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
        }
        send(404, { error: { message: "nf" } });
    });
});

let dir;
(async () => {
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    process.env.OPENAI_API_KEY = "sk-test-http"; process.env.BOT_TOKEN = "123456789:AAH-testtokentesttokentesttoken12345";
    process.env.VOICE_MAX_RETRIES = "1";
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vh-"));
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=200:duration=2", "-c:a", "libopus", path.join(dir, "uz_sale_1.ogg")]);
    fs.copyFileSync(path.join(dir, "uz_sale_1.ogg"), path.join(dir, "uz_expense_1.ogg"));
    const ogg = fs.readFileSync(path.join(dir, "uz_sale_1.ogg"));
    global.fetch = ((orig) => async (url, o) => String(url).startsWith("https://api.telegram.org/") ? new Response(ogg, { status: 200 }) : orig(url, o))(global.fetch);
    const stt = require("../src/services/stt");
    const { normalizeSaleTextWithAI } = require("../src/services/aiSale");
    const bot = { getFile: async () => ({ file_path: "voice/a.oga", file_size: ogg.length }) };

    test("STT so'rovi: multipart, model, prompt (sotuv), language yo'q (avto), json; Authorization header", async () => {
        mode = "ok"; reqs.length = 0;
        eq(await stt.transcribeTelegramVoice(bot, "f", { kind: "sale" }), "tort 140 ming sham 2 ta 5 ming");
        const r = reqs.find(x => x.url === "/v1/audio/transcriptions"); const b = r.body.toString("latin1");
        ok(r.ct.startsWith("multipart/form-data"), r.ct); ok(b.includes('name="model"') && b.includes("gpt-4o-mini-transcribe"));
        ok(b.includes('name="prompt"') && b.includes("Mahsulotlar"), "prompt"); ok(!b.includes('name="language"'), "language yo'q");
        ok(b.includes("RIFF") && b.includes("WAVE"), "wav yuborildi"); eq(r.auth, "Bearer sk-test-http");
    });
    test("chat so'rovi: model, temperature 0, max_tokens; natija sxemadan o'tadi", async () => {
        reqs.length = 0; eq(await normalizeSaleTextWithAI("tort 140 ming sham 2 ta 5 ming"), "Tort 140000, Sham 2ta 5000");
        const p = JSON.parse(reqs[0].body.toString()); eq([p.model, p.temperature, p.max_tokens], ["gpt-4o-mini", 0, 80]);
        ok(p.messages[1].content.startsWith("<speech>"), "nutq ajratilgan");
    });
    test("HTTP 401 → OPENAI_AUTH_FAILED, retry yo'q, kalit xato matnida bo'lsa ham log'ga to'liq chiqmaydi", async () => {
        mode = "401"; reqs.length = 0;
        await rejectsCode(stt.transcribeTelegramVoice(bot, "f"), "OPENAI_AUTH_FAILED"); eq(reqs.filter(x => x.url.includes("transcriptions")).length, 1);
    });
    test("HTTP 503 → 1 retry, keyin OPENAI_TEMP_UNAVAILABLE", async () => {
        mode = "503"; reqs.length = 0;
        await rejectsCode(stt.transcribeTelegramVoice(bot, "f"), "OPENAI_TEMP_UNAVAILABLE"); eq(reqs.filter(x => x.url.includes("transcriptions")).length, 2);
    });
    test("scripts/voice-check.js: model ruxsati + baholash (hech narsa saqlanmaydi), XATO AVTOMATIK=0", async () => {
        mode = "ok";
        fs.writeFileSync(path.join(dir, "cases.json"), JSON.stringify([
            { file: "uz_sale_1.ogg", lang: "uz", kind: "sale", expect: { items: [{ price: 140000 }, { price: 5000, qty: 2 }] } },
            { file: "uz_expense_1.ogg", lang: "uz", kind: "expense", expect: { categoryKey: "taxi", amount: 25000 } }]));
        const out = await new Promise(r => execFile("node", [path.join(__dirname, "..", "scripts", "voice-check.js"), dir], { env: process.env, timeout: 60000 }, (e, so, se) => r({ code: e?.code || 0, so: so + se })));
        ok(out.so.includes("model ruxsati bor: gpt-4o-mini-transcribe"), out.so);
        ok(/XATO AVTOMATIK: 0/.test(out.so), out.so);
        ok(out.so.includes("To'g'ri avtomatik: 1"), "sotuv to'g'ri avtomatik: " + out.so);
    });
    await run("HTTP E2E (haqiqiy SDK)");
})();
