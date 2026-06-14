// src/services/aiSale.js
// Ovozli sotuv matni → standart format
const { openai } = require("./openai");

function mapAiError(err) {
    const msg    = String(err?.message || "").toLowerCase();
    const status = err?.status || err?.code || 0;
    if (status === 401 || msg.includes("incorrect api key") || msg.includes("invalid_api_key"))
        return new Error("OPENAI_AUTH_FAILED");
    if (status === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("insufficient_quota"))
        return new Error("OPENAI_QUOTA_OR_LIMIT");
    if (status === 500 || status >= 502 || msg.includes("timeout"))
        return new Error("OPENAI_TEMP_UNAVAILABLE");
    return new Error("OPENAI_AI_FAILED");
}

const SYSTEM_PROMPT = `Siz tort do'koni uchun sotuv matnini standartlashtirasiz.
FAQAT 1 qator toza natija qaytaring. Izoh yozmang. Prefiks yozmang.

FORMAT: Mahsulot [miqdor]ta [narx], Mahsulot2 [narx], berdi [to'langan], tel [raqam]

QOIDALAR:
1. Narxlar: "bir yuz yigirma ming" → 120000, "120ming" → 120000, "yuz ellik" → 150000
2. Miqdor: "ikkita" → 2ta, "3 dona" → 3ta
3. To'langan pul: "berdi 300 ming", "to'ladi 200", "naqd 150000"  
4. Qarz: agar berdi < jami → qarz avtomatik aniqlanadi
5. Telefon: "tel 901234567" yoki "998901234567"
6. Mahsulot nomlari: tort turlarini to'g'ri yoz (Tort Shokoladniy, Bento, Perojniy, Pepsi...)

MISOL KIRITMA: "ikkita shokolad tort yuz yigirma mingdan bir dona bento yetmish uch ming berdi uch yuz ellik ming"
MISOL NATIJA: Tort Shokoladniy 2ta 120000, Bento 1ta 73000, berdi 350000

MISOL KIRITMA: "napoleon tort 140 mingdan bir dona sotdim telefon 901234567"
MISOL NATIJA: Tort Napoleon 140000, tel 901234567

MISOL KIRITMA: "rafaello tort yuz yigirma ming qarzga"
MISOL NATIJA: Tort Rafaello 120000, berdi 0`;

async function normalizeSaleTextWithAI(rawText) {
    const input = String(rawText || "").trim();
    if (!input) return "";

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            temperature: 0,
            max_tokens: 120,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user",   content: input }
            ]
        });

        return String(resp.choices?.[0]?.message?.content || "").trim();
    } catch (err) {
        console.error("AI_SALE_ERROR:", { message: err?.message, status: err?.status });
        throw mapAiError(err);
    }
}

module.exports = { normalizeSaleTextWithAI };
