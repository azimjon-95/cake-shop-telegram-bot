// src/services/voiceConfig.js
// Ovoz moduli sozlamalari: env ni parse + diapazon tekshiruvi (noto'g'ri qiymat → xavfsiz default + ogohlantirish).
// Hamma getter har safar env dan o'qiydi (testlarda/hot-reload da to'g'ri ishlashi uchun).

const warned = new Set();
function warnOnce(msg) {
    if (warned.has(msg)) return;
    warned.add(msg);
    console.warn("⚠️ [voice-config]", msg);
}

function num(name, def, min, max) {
    const raw = process.env[name];
    if (raw === undefined || String(raw).trim() === "") return def;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || v > max) {
        warnOnce(`${name}="${raw}" noto'g'ri (${min}..${max}) — default ${def} ishlatiladi`);
        return def;
    }
    return v;
}

function str(name, def) {
    const v = process.env[name];
    return v === undefined || String(v).trim() === "" ? def : String(v).trim();
}

function getVoiceConfig() {
    const cfg = {
        maxSec:        num("VOICE_MAX_SEC", 40, 2, 600),
        minSec:        num("VOICE_MIN_SEC", 1, 0, 30),
        maxFileMb:     num("VOICE_MAX_FILE_MB", 20, 0.1, 24),   // OpenAI chegarasi 25MB
        processTimeoutMs:  num("VOICE_PROCESS_TIMEOUT_MS", 90000, 5000, 600000),
        downloadTimeoutMs: num("VOICE_DOWNLOAD_TIMEOUT_MS", 20000, 1000, 120000),
        ffmpegTimeoutMs:   num("VOICE_FFMPEG_TIMEOUT_MS", 30000, 1000, 120000),
        maxRetries:    Math.floor(num("VOICE_MAX_RETRIES", 2, 0, 5)),
        userConcurrency: Math.floor(num("VOICE_USER_CONCURRENCY", 1, 1, 5)),
        ffmpegPath:    str("FFMPEG_PATH", "ffmpeg"),
        sttModel:      str("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe"),
        chatModel:     str("OPENAI_MODEL", "gpt-4o-mini"),
        // Bo'sh = avtomatik til aniqlash (uz/ru aralash nutq uchun xavfsizroq). ISO-639-1 kod: "uz", "ru"
        sttLanguage:   (process.env.STT_LANGUAGE || "").trim().toLowerCase(),
    };
    if (cfg.minSec >= cfg.maxSec) {
        warnOnce("VOICE_MIN_SEC >= VOICE_MAX_SEC — default 1/40 ishlatiladi");
        cfg.minSec = 1; cfg.maxSec = 40;
    }
    if (cfg.sttLanguage && !/^[a-z]{2}$/.test(cfg.sttLanguage)) {
        warnOnce(`STT_LANGUAGE="${cfg.sttLanguage}" ISO-639-1 emas — avtomatik aniqlash`);
        cfg.sttLanguage = "";
    }
    return cfg;
}

// Startup tekshiruvi (index.js dan)
function validateVoiceConfig() {
    const cfg = getVoiceConfig();
    if (!process.env.OPENAI_API_KEY) {
        console.warn("⚠️ [voice-config] OPENAI_API_KEY yo'q — ovozli xabar ishlamaydi");
    }
    return cfg;
}

module.exports = { getVoiceConfig, validateVoiceConfig };
