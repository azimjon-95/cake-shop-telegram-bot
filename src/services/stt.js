const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { BOT_TOKEN } = require("../config");
const { openai } = require("./openai");

function ensureTmpDir() {
    const dir = path.join(process.cwd(), "tmp");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function downloadFile(url, outPath) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`TELEGRAM_DOWNLOAD_FAILED:${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outPath, buf);
}

function getFfmpegPath() {
    return process.env.FFMPEG_PATH || "ffmpeg";
}

function ffmpegToWav(input, output) {
    return new Promise((resolve, reject) => {
        const ffmpegBin = getFfmpegPath();

        console.log("FFMPEG BIN:", ffmpegBin);
        console.log("FFMPEG INPUT:", input);
        console.log("FFMPEG OUTPUT:", output);

        execFile(
            ffmpegBin,
            ["-y", "-i", input, "-ar", "16000", "-ac", "1", output],
            (err, stdout, stderr) => {
                if (err) {
                    console.error("FFMPEG ERROR OBJECT:", err);
                    console.error("FFMPEG STDERR:", stderr);
                    console.error("FFMPEG STDOUT:", stdout);

                    if (err.code === "ENOENT") {
                        return reject(new Error("FFMPEG_NOT_INSTALLED"));
                    }

                    return reject(new Error("FFMPEG_FAILED"));
                }

                resolve();
            }
        );
    });
}

function safeDelete(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (_) { }
}

function mapOpenAiError(err) {
    const msg = String(err?.message || "").toLowerCase();
    const status = err?.status || err?.code || 0;

    if (status === 401 || msg.includes("incorrect api key") || msg.includes("invalid_api_key")) {
        return new Error("OPENAI_AUTH_FAILED");
    }

    if (status === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("insufficient_quota")) {
        return new Error("OPENAI_QUOTA_OR_LIMIT");
    }

    if (status === 500 || status === 502 || status === 503 || status === 504 || msg.includes("timeout")) {
        return new Error("OPENAI_TEMP_UNAVAILABLE");
    }

    return new Error("OPENAI_STT_FAILED");
}

// Sotuv ovozi uchun tayanch matn: mahsulot nomlari va "ming" aytilishi — raqam/nom aniqroq chiqadi
function saleHintPrompt() {
    try {
        const { SALE_TEMPLATE_ITEMS } = require("../logic/saleDraft");
        const names = [...new Set(Object.values(SALE_TEMPLATE_ITEMS).flat().map(x => x.name))].join(", ");
        return `Tort do'koni sotuvi. Mahsulotlar: ${names}. Narxlar: 140 ming, 5 ming, 120 ming. Miqdor: 2 ta.`;
    } catch { return undefined; }
}

async function transcribeTelegramVoice(bot, fileId, opts = {}) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY_MISSING");
    }

    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;

    const tmpDir = ensureTmpDir();
    const oggPath = path.join(tmpDir, `${fileId}.ogg`);
    const wavPath = path.join(tmpDir, `${fileId}.wav`);

    try {
        await downloadFile(fileUrl, oggPath);
        await ffmpegToWav(oggPath, wavPath);

        const params = { model: "gpt-4o-mini-transcribe" };
        const lang = process.env.STT_LANGUAGE === undefined ? "uz" : process.env.STT_LANGUAGE;
        if (lang) params.language = lang;
        if (opts.kind === "sale") {
            const hint = saleHintPrompt();
            if (hint) params.prompt = hint;
        }

        let tr;
        try {
            tr = await openai.audio.transcriptions.create({ ...params, file: fs.createReadStream(wavPath) });
        } catch (e) {
            // Til/prompt qo'llab-quvvatlanmasa — oddiy rejimda qayta urinamiz
            if (e?.status === 400 && (params.language || params.prompt)) {
                delete params.language; delete params.prompt;
                tr = await openai.audio.transcriptions.create({ ...params, file: fs.createReadStream(wavPath) });
            } else throw e;
        }

        return String(tr?.text || "").trim();
    } catch (err) {
        if (
            String(err?.message || "").startsWith("OPENAI_") ||
            String(err?.message || "").startsWith("TELEGRAM_") ||
            String(err?.message || "").startsWith("FFMPEG_")
        ) {
            throw err;
        }

        throw mapOpenAiError(err);
    } finally {
        safeDelete(oggPath);
        safeDelete(wavPath);
    }
}

module.exports = {
    transcribeTelegramVoice
};