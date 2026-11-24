// src/services/openai.js
// Yagona OpenAI client (bir marta yaratiladi) + xatolarni standart kodlarga o'tkazish + cheklangan retry.

const OpenAI = require("openai");
const { getVoiceConfig } = require("./voiceConfig");

// maxRetries:0 — retry'ni o'zimiz boshqaramiz (umumiy vaqt byudjeti ichida)
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing-key",
    maxRetries: 0,
    timeout: 45_000,
});

// Ichki xato: .code — standart kod, .retryable — faqat vaqtinchalik xatolar
class VoiceError extends Error {
    constructor(code, opts = {}) {
        super(code);
        this.name = "VoiceError";
        this.code = code;
        this.retryable = !!opts.retryable;
        if (opts.cause) this.cause = opts.cause;
    }
}

function hasKey() {
    return !!process.env.OPENAI_API_KEY;
}

// ctx: "stt" | "ai" — noma'lum xato qaysi umumiy kodga tushishini belgilaydi
function mapOpenAiError(err, ctx = "ai") {
    if (err instanceof VoiceError) return err;

    const status = Number(err?.status || 0);
    const msg = String(err?.message || "").toLowerCase();
    const code = String(err?.code || err?.error?.code || "").toLowerCase();
    const name = String(err?.name || "");

    if (status === 401 || status === 403 || code === "invalid_api_key" || msg.includes("incorrect api key"))
        return new VoiceError("OPENAI_AUTH_FAILED", { cause: err });
    if (code === "insufficient_quota" || msg.includes("exceeded your current quota") || msg.includes("billing"))
        return new VoiceError("OPENAI_QUOTA_OR_LIMIT", { cause: err });
    if (status === 429 || code === "rate_limit_exceeded")
        return new VoiceError("OPENAI_RATE_LIMIT", { cause: err });
    if (status === 404 || code === "model_not_found" || (msg.includes("model") && (msg.includes("does not exist") || msg.includes("do not have access"))))
        return new VoiceError("OPENAI_MODEL_UNAVAILABLE", { cause: err });
    if (ctx === "stt" && status === 400 && /(audio|file|format|decode|corrupt|too short|duration)/.test(msg))
        return new VoiceError("OPENAI_INVALID_AUDIO", { cause: err });
    if (status >= 500 || name === "APIConnectionError" || name === "APIConnectionTimeoutError" ||
        /(timeout|timed out|econnreset|etimedout|enotfound|eai_again|socket hang up|fetch failed)/.test(msg))
        return new VoiceError("OPENAI_TEMP_UNAVAILABLE", { retryable: true, cause: err });

    return new VoiceError(ctx === "stt" ? "STT_FAILED" : "AI_NORMALIZATION_FAILED", { cause: err });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Faqat retryable xatolarda, exponential backoff + jitter, umumiy byudjet (deadline) ichida.
// fn(attempt) — xatoni VoiceError sifatida tashlashi shart.
async function withRetry(fn, { maxRetries, deadline } = {}) {
    const retries = maxRetries ?? getVoiceConfig().maxRetries;
    let attempt = 0;
    for (;;) {
        try {
            return await fn(attempt);
        } catch (e) {
            const delay = 400 * 2 ** attempt + Math.floor(Math.random() * 200);
            const timeLeft = deadline ? deadline - Date.now() : Infinity;
            if (!e?.retryable || attempt >= retries || timeLeft < delay + 3000) throw e;
            attempt++;
            await sleep(delay);
        }
    }
}

// gpt-5.x / o-seriya (reasoning) modellari: max_tokens va temperature qo'llab-quvvatlanmaydi
function isReasoningModel(model) {
    return /^(gpt-5|o\d)/i.test(String(model || ""));
}

// Qisqa chat so'rov (sotuv/chiqim normalizatsiyasi). Qaytaradi: matn.
async function chatText({ system, user, maxOut = 80, deadline, json = false }) {
    if (!hasKey()) throw new VoiceError("OPENAI_AUTH_FAILED");
    const model = getVoiceConfig().chatModel;

    // Parametrlar modelga qarab; 400 "unsupported parameter" bo'lsa — bir marta moslab qayta urinamiz
    const reasoning = isReasoningModel(model);
    const p = reasoning
        ? { max_completion_tokens: Math.max(600, maxOut * 8) }   // reasoning tokenlar ham shu byudjetdan
        : { temperature: 0, max_tokens: maxOut };

    if (json) p.response_format = { type: "json_object" };   // Structured JSON rejimi (prompt'da "JSON" so'zi bor)

    const call = () => openai.chat.completions.create({
        model, ...p,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });

    return withRetry(async () => {
        let resp;
        try {
            try {
                resp = await call();
            } catch (e) {
                const m = String(e?.message || "").toLowerCase();
                if (Number(e?.status) !== 400) throw e;
                let changed = false;
                if (m.includes("max_tokens") && p.max_tokens) { p.max_completion_tokens = Math.max(600, maxOut * 8); delete p.max_tokens; changed = true; }
                else if (m.includes("max_completion_tokens") && p.max_completion_tokens) { p.max_tokens = maxOut; delete p.max_completion_tokens; changed = true; }
                if (m.includes("temperature") && "temperature" in p) { delete p.temperature; changed = true; }
                if (m.includes("response_format") && p.response_format) { delete p.response_format; changed = true; }
                if (!changed) throw e;
                resp = await call();
            }
        } catch (e) {
            throw mapOpenAiError(e, "ai");
        }
        return String(resp.choices?.[0]?.message?.content || "").trim();
    }, { deadline });
}

module.exports = { openai, VoiceError, mapOpenAiError, withRetry, chatText, hasKey, isReasoningModel };
