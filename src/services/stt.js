// src/services/stt.js
// Telegram voice → (bounded download) → FFmpeg WAV → OpenAI transcription.
// Xavfsizlik: token log'ga chiqmaydi, har request o'z temp papkasida, finally'da tozalanadi,
// yuklash hajm/vaqt bilan cheklangan, ffmpeg execFile (shell yo'q) + timeout.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { BOT_TOKEN } = require("../config");
const { openai, VoiceError, mapOpenAiError, withRetry, hasKey } = require("./openai");
const { getVoiceConfig } = require("./voiceConfig");

const TMP_BASE = path.join(os.tmpdir(), "totli-voice");
const STALE_MS = 30 * 60 * 1000;
const ALLOWED_EXT = new Set([".oga", ".ogg", ".opus", ".mp3", ".m4a", ".wav", ".webm"]);

// ── Yordamchilar ────────────────────────────────────────
// Log/xabarlardan bot tokenini olib tashlash
function redact(s) {
    let out = String(s ?? "");
    if (BOT_TOKEN) out = out.split(BOT_TOKEN).join("***");
    return out.replace(/bot\d{6,}:[\w-]{20,}/g, "bot***");
}

function ensureTmpBase() {
    fs.mkdirSync(TMP_BASE, { recursive: true, mode: 0o700 });
    return TMP_BASE;
}

// Faqat TMP_BASE ichidagi eski (30 daqiqadan) fayl/papkalarni o'chiradi (crash'dan qolganlar)
function cleanupStaleTmp(now = Date.now()) {
    let removed = 0;
    try {
        for (const name of fs.readdirSync(TMP_BASE)) {
            const p = path.join(TMP_BASE, name);
            try {
                const st = fs.lstatSync(p);                       // symlink'ni kuzatmaymiz
                if (now - st.mtimeMs > STALE_MS) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
            } catch { /* keyingisiga */ }
        }
    } catch { /* papka hali yo'q */ }
    return removed;
}

let _cleanTimer = null;
function scheduleVoiceTmpCleanup() {
    if (_cleanTimer) return;
    ensureTmpBase();
    cleanupStaleTmp();
    _cleanTimer = setInterval(() => cleanupStaleTmp(), 10 * 60 * 1000);
    if (_cleanTimer.unref) _cleanTimer.unref();
}

// Har request uchun noyob papka (parallel requestlar to'qnashmaydi)
function makeRequestDir() {
    ensureTmpBase();
    return fs.mkdtempSync(path.join(TMP_BASE, "v-"));
}

// ── 1. Telegram'dan cheklangan yuklash ───────────────────
async function downloadTelegramFile(bot, fileId, destPath, cfg) {
    const maxBytes = Math.floor(cfg.maxFileMb * 1024 * 1024);

    let file;
    try {
        file = await bot.getFile(fileId);
    } catch (e) {
        const m = String(e?.message || "").toLowerCase();
        if (m.includes("too big")) throw new VoiceError("VOICE_FILE_TOO_LARGE");
        throw new VoiceError("TELEGRAM_FILE_UNAVAILABLE", { cause: e });
    }

    const fp = String(file?.file_path || "");
    if (!fp || fp.includes("..") || !/^[\w\-./]+$/.test(fp))
        throw new VoiceError("TELEGRAM_FILE_UNAVAILABLE");
    if (!ALLOWED_EXT.has(path.extname(fp).toLowerCase()))
        throw new VoiceError("TELEGRAM_FILE_UNAVAILABLE");
    if (file.file_size && Number(file.file_size) > maxBytes)
        throw new VoiceError("VOICE_FILE_TOO_LARGE");

    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fp}`;   // log'ga HECH QACHON chiqarilmaydi
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.downloadTimeoutMs);

    try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new VoiceError("TELEGRAM_DOWNLOAD_FAILED", { retryable: res.status >= 500 });
        const len = Number(res.headers.get("content-length") || 0);
        if (len && len > maxBytes) throw new VoiceError("VOICE_FILE_TOO_LARGE");
        if (!res.body) throw new VoiceError("TELEGRAM_DOWNLOAD_FAILED");

        const out = fs.createWriteStream(destPath, { mode: 0o600 });
        let total = 0;
        try {
            for await (const chunk of res.body) {                  // oqim: RAM'ga to'liq olinmaydi
                total += chunk.length;
                if (total > maxBytes) throw new VoiceError("VOICE_FILE_TOO_LARGE");
                if (!out.write(chunk)) await new Promise(r => out.once("drain", r));
            }
        } finally {
            await new Promise(r => out.end(r));
        }
        if (total === 0) throw new VoiceError("TELEGRAM_FILE_UNAVAILABLE");
        return total;
    } catch (e) {
        if (e instanceof VoiceError) throw e;
        if (e?.name === "AbortError") throw new VoiceError("TELEGRAM_DOWNLOAD_FAILED", { retryable: true });
        throw new VoiceError("TELEGRAM_DOWNLOAD_FAILED", { retryable: true });
    } finally {
        clearTimeout(timer);
    }
}

// Faylning boshi: Telegram voice = Ogg ("OggS")
function looksLikeOgg(filePath) {
    try {
        const fd = fs.openSync(filePath, "r");
        const b = Buffer.alloc(4);
        fs.readSync(fd, b, 0, 4, 0);
        fs.closeSync(fd);
        return b.toString("latin1") === "OggS";
    } catch { return false; }
}

// ── 2. FFmpeg ────────────────────────────────────────────
function ffmpegToWav(input, output, cfg) {
    return new Promise((resolve, reject) => {
        execFile(
            cfg.ffmpegPath,
            ["-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-i", input, "-t", String(cfg.maxSec + 5),
                "-ar", "16000", "-ac", "1", "-f", "wav", output],
            { timeout: cfg.ffmpegTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
            (err, _stdout, stderr) => {
                if (err) {
                    if (err.code === "ENOENT") return reject(new VoiceError("FFMPEG_NOT_INSTALLED"));
                    if (err.killed || err.signal) return reject(new VoiceError("FFMPEG_TIMEOUT"));
                    console.error("[voice] ffmpeg xato kodi:", err.code, redact(String(stderr || "").slice(0, 300)));
                    return reject(new VoiceError("FFMPEG_FAILED"));
                }
                try {
                    if (fs.statSync(output).size <= 44) return reject(new VoiceError("FFMPEG_FAILED")); // WAV sarlavhasidan kichik = bo'sh
                } catch { return reject(new VoiceError("FFMPEG_FAILED")); }
                resolve();
            }
        );
    });
}

// ── 3. STT ───────────────────────────────────────────────
// Sotuv ovozi uchun tayanch matn (OpenAI hujjatidagi `prompt` maydoni): mahsulot nomlari va pul iboralari
function saleHintPrompt() {
    try {
        const { SALE_TEMPLATE_ITEMS } = require("../logic/saleDraft");
        const names = [...new Set(Object.values(SALE_TEMPLATE_ITEMS).flat().map(x => x.name))].join(", ");
        return `Tort do'koni sotuvi. Mahsulotlar: ${names}. Narxlar: 140 ming, 5 ming, 120 ming. Miqdor: 2 ta.`;
    } catch { return undefined; }
}

async function callTranscription(wavPath, opts, cfg, deadline) {
    const base = { model: cfg.sttModel };
    if (cfg.sttLanguage) base.language = cfg.sttLanguage;           // ISO-639-1 (hujjatlashtirilgan `language`)
    if (opts.kind === "sale") {
        const hint = saleHintPrompt();
        if (hint) base.prompt = hint;
    }

    return withRetry(async () => {
        const timeout = Math.max(5000, Math.min(60_000, deadline - Date.now()));
        // Har urinishda yangi stream. error handler + destroy: fayl o'chirilganda (cleanup) handle'siz
        // 'error' event butun processni yiqitmasligi uchun.
        const run = async (params) => {
            const stream = fs.createReadStream(wavPath);
            stream.on("error", () => { });
            try {
                return await openai.audio.transcriptions.create({ ...params, file: stream }, { timeout });
            } finally {
                stream.destroy();
            }
        };
        try {
            try {
                return await run(base);
            } catch (e) {
                // language/prompt sababli 400 bo'lsa — ularsiz bir marta qayta urinish
                const m = String(e?.message || "").toLowerCase();
                if (Number(e?.status) === 400 && (base.language || base.prompt) && /(language|prompt)/.test(m)) {
                    const { language, prompt, ...plain } = base;
                    return await run(plain);
                }
                throw e;
            }
        } catch (e) {
            throw mapOpenAiError(e, "stt");
        }
    }, { maxRetries: cfg.maxRetries, deadline });
}

/**
 * Telegram voice → matn.
 * opts: { kind: "sale"|"expense", deadline?: ms epoch, timings?: object (to'ldiriladi) }
 * Xato: VoiceError (.code). Bo'sh natija: VoiceError("STT_EMPTY_RESULT").
 */
async function transcribeTelegramVoice(bot, fileId, opts = {}) {
    if (!hasKey()) throw new VoiceError("OPENAI_AUTH_FAILED");
    const cfg = getVoiceConfig();
    const deadline = opts.deadline || Date.now() + cfg.processTimeoutMs;
    const timings = opts.timings || {};

    const dir = makeRequestDir();
    const oggPath = path.join(dir, "in.ogg");
    const wavPath = path.join(dir, "out.wav");

    try {
        let t = Date.now();
        await withRetry(() => downloadTelegramFile(bot, fileId, oggPath, cfg), { maxRetries: 1, deadline });
        timings.download = Date.now() - t;

        if (!looksLikeOgg(oggPath)) throw new VoiceError("FFMPEG_FAILED");   // kutilgan format emas

        t = Date.now();
        await ffmpegToWav(oggPath, wavPath, cfg);
        timings.convert = Date.now() - t;

        t = Date.now();
        const tr = await callTranscription(wavPath, opts, cfg, deadline);
        timings.stt = Date.now() - t;

        const text = String(tr?.text || "").trim();
        if (!text) throw new VoiceError("STT_EMPTY_RESULT");
        return text;
    } catch (e) {
        if (e instanceof VoiceError) throw e;
        throw new VoiceError("STT_FAILED", { cause: e });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* cleanup sekin bo'lsa ham asosiy oqim buzilmasin */ }
    }
}

module.exports = {
    transcribeTelegramVoice,
    scheduleVoiceTmpCleanup,
    cleanupStaleTmp,
    makeRequestDir,
    redact,
    TMP_BASE,
};
