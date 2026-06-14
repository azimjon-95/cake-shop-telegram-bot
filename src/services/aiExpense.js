// src/services/aiExpense.js
// Ovozli chiqim matni → JSON
const { openai } = require("./openai");

function mapAiError(err) {
    const msg    = String(err?.message || "").toLowerCase();
    const status = err?.status || err?.code || 0;
    if (status === 401 || msg.includes("incorrect api key") || msg.includes("invalid_api_key"))
        return new Error("OPENAI_AUTH_FAILED");
    if (status === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("insufficient_quota"))
        return new Error("OPENAI_QUOTA_OR_LIMIT");
    if (status >= 500 || msg.includes("timeout"))
        return new Error("OPENAI_TEMP_UNAVAILABLE");
    return new Error("OPENAI_AI_FAILED");
}

const SYSTEM_PROMPT = `Siz tort do'koni chiqim ovozli matnini JSONga aylantirasiz.
FAQAT JSON qaytaring. Hech qanday izoh, markdown, code block yozmang.

KATEGORIYALAR:
- "rent"        → arenda, ijara, xona haqi
- "electricity" → elektr, svet, kommunal
- "supplier"    → firma, taminot, mol, xom ashyo
- "worker"      → ishchi haqi, maosh, bonus
- "food"        → oziq-ovqat, non, sabzavot, meva
- "taxi"        → taksi, yo'l haqi, benzin, avtomobil
- "repair"      → ta'mirlash, usta, asbob
- "bank"        → bank, karta, o'tkazma, komissiya
- "cash"        → kassa, naqd, inkassatsiya
- "other"       → boshqa

NARX FORMAT: "yuz ming" → 100000, "50 ming" → 50000, "bir yarim million" → 1500000

FORMAT: {"categoryKey":"...","amount":NUMBER,"description":"..."}
description: qisqa tavsif (bo'sh bo'lsa "")

MISOL: "ustaga eshik tuzatish uchun yuz yigirma ming berdim"
NATIJA: {"categoryKey":"repair","amount":120000,"description":"eshik tuzatish"}

MISOL: "elektr uchun sakson ming to'ladim"
NATIJA: {"categoryKey":"electricity","amount":80000,"description":""}

MISOL: "taminotga un va yog uchun uch yuz ming"
NATIJA: {"categoryKey":"supplier","amount":300000,"description":"un va yog"}`;

async function normalizeExpenseVoiceText(rawText) {
    const input = String(rawText || "").trim();
    if (!input) return null;

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            temperature: 0,
            max_tokens: 80,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: input }
            ]
        });

        const txt = String(resp.choices?.[0]?.message?.content || "").trim();
        // Agar markdown code block bo'lsa tozalaymiz
        const clean = txt.replace(/```json?|```/g, "").trim();
        return JSON.parse(clean);
    } catch (err) {
        if (err instanceof SyntaxError) throw new Error("OPENAI_AI_FAILED");
        throw mapAiError(err);
    }
}

module.exports = { normalizeExpenseVoiceText };
