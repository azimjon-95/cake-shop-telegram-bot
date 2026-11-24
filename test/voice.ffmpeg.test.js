// Haqiqiy FFmpeg bilan: Telegram voice (OGG/Opus) → 16 kHz mono WAV; buzuq fayl; cheklov. ffmpeg bo'lmasa — o'tkazib yuboriladi.
process.env.BOT_TOKEN = "123456789:AAH-testtokentesttokentesttoken12345";
process.env.OPENAI_API_KEY = "sk-test";
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const { test, eq, ok, rejectsCode, run } = require("./_harness");

let hasFfmpeg = true;
try { execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" }); } catch { hasFfmpeg = false; }
if (!hasFfmpeg) { console.log("⚠️ ffmpeg topilmadi — test o'tkazib yuborildi"); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffx-"));
const mk = (name, sec) => { const p = path.join(dir, name); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=300:duration=${sec}`, "-ac", "2", "-ar", "48000", "-c:a", "libopus", p]); return fs.readFileSync(p); };
const ogg3 = mk("a.ogg", 3), ogg60 = mk("b.ogg", 60);
const corrupt = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(3000, 7)]);

let body = ogg3;
global.fetch = async () => new Response(body, { status: 200 });
const stt = require("../src/services/stt");
const { openai } = require("../src/services/openai");
let wavInfo = null;
openai.audio.transcriptions.create = async (p) => {
    const chunks = []; for await (const c of p.file) chunks.push(c); const b = Buffer.concat(chunks);
    wavInfo = { riff: b.toString("latin1", 0, 4), wave: b.toString("latin1", 8, 12), channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), dataSec: (b.length - 44) / (b.readUInt32LE(24) * 2) };
    return { text: "tort 140 ming" };
};
const bot = { getFile: async () => ({ file_path: "voice/x.oga", file_size: body.length }) };

test("OGG/Opus 48kHz stereo → WAV 16kHz mono 16-bit (OpenAI qabul qiladigan format)", async () => {
    body = ogg3; eq(await stt.transcribeTelegramVoice(bot, "f"), "tort 140 ming");
    eq([wavInfo.riff, wavInfo.wave, wavInfo.channels, wavInfo.rate, wavInfo.bits], ["RIFF", "WAVE", 1, 16000, 16]);
    ok(Math.abs(wavInfo.dataSec - 3) < 0.2, "davomiylik ~3s: " + wavInfo.dataSec);
});
test("uzun audio konvertatsiyada maxSec+5 bilan kesiladi (API'ga ortiqcha yuborilmaydi)", async () => {
    body = ogg60; await stt.transcribeTelegramVoice({ getFile: async () => ({ file_path: "voice/x.oga", file_size: body.length }) }, "f");
    ok(wavInfo.dataSec <= 45.2, "kesilgan: " + wavInfo.dataSec);
});
test("buzuq OGG → FFMPEG_FAILED, temp tozalanadi", async () => {
    body = corrupt; const before = fs.readdirSync(stt.TMP_BASE).length;
    await rejectsCode(stt.transcribeTelegramVoice({ getFile: async () => ({ file_path: "voice/x.oga", file_size: body.length }) }, "f"), "FFMPEG_FAILED");
    eq(fs.readdirSync(stt.TMP_BASE).length, before);
});
test("noto'g'ri FFMPEG_PATH → FFMPEG_NOT_INSTALLED", async () => {
    process.env.FFMPEG_PATH = "/nonexistent/ffmpeg"; body = ogg3;
    await rejectsCode(stt.transcribeTelegramVoice(bot, "f"), "FFMPEG_NOT_INSTALLED"); delete process.env.FFMPEG_PATH;
});
test("temp fayllar huquqi: papka 0700", () => { eq((fs.statSync(stt.TMP_BASE).mode & 0o777).toString(8), "700"); });

run("FFMPEG (haqiqiy)").finally?.(() => fs.rmSync(dir, { recursive: true, force: true }));
