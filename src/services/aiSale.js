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

// Katalog nomlari — AI ovozdan eshitilgan nomni (masalan "shap" → "Sham") to'g'ri nomga moslashtirsin
function catalogNames() {
    try {
        const { SALE_TEMPLATE_ITEMS } = require("../logic/saleDraft");
        return [...new Set(Object.values(SALE_TEMPLATE_ITEMS).flat().map(x => x.name))];
    } catch { return []; }
}

function buildSystemPrompt() {
    return `Tort do'koni kassiri ovozli xabarini sotuv qatoriga aylantirasiz.
Faqat 1 qator natija yoki NO qaytaring. Izoh, prefiks yozmang.

FORMAT: Mahsulot [N]ta narx, Mahsulot2 narx, tel 901234567
(narx = BIR DONA narxi, so'mda. "140 ming"/"140ming"/"yuz qirq ming" → 140000, "5 minga" → 5000)
TO'LOV: standart — to'liq to'langan (hech narsa yozilmaydi).
  Qarzga / to'lamadi → narxdan keyin "-0":  Tort 125000-0
  Qisman to'ladi (mijoz X berdi) → "-X":  Tort 140000-100000  (faqat 1 dona tovar uchun)

QOIDALAR:
- Sotuv bo'lsa (mahsulot + narx): format bo'yicha yozing. "sotildi/sotdim/berdi/ga/dan" kabi so'zlar nomga kirmaydi.
- Miqdor: "2 ta", "ikkita", "2 dona" → 2ta. Aytilmasa miqdor yozilmaydi.
- Mahsulot nomi: quyidagi katalogdagi eng yaqin nomga moslang; mos kelmasa eshitilganicha bosh harf bilan yozing.
- Mahsulot aytilmasdan faqat "tort 140 ming" desa → "Tort 140000".
- Sotuvga aloqasi yo'q gap (salom, savol, suhbat, narxsiz/mahsulotsiz) → faqat: NO
- Narx aniq bo'lmasa → NO

KATALOG: ${catalogNames().join(", ")}

MISOL: "tort sotildi 140 mingga shap 2 ta 5 minga" → Tort 140000, Sham 2ta 5000
MISOL: "ikkita shokolad tort yuz yigirma mingdan bir dona bento yetmish ming berdi uch yuz ellik ming" → Tort Shokoladniy 2ta 120000, Bento 70000
MISOL: "damashniy tort 140 ming" → Tort Damashniy 140000
MISOL: "rafaello qarzga yuz yigirma besh ming tel 901234567" → Tort Rafaello 125000-0, tel 901234567
MISOL: "bugun havo yaxshi ekan" → NO`;
}

// AI "NO" qaytarsa — sotuv emas
function isNoSale(text) {
    return /^\s*no\b/i.test(String(text || "")) || !String(text || "").trim();
}

async function normalizeSaleTextWithAI(rawText) {
    const input = String(rawText || "").trim();
    if (!input) return "";

    try {
        const resp = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4o-mini",
            temperature: 0,
            max_tokens: 80,
            messages: [
                { role: "system", content: buildSystemPrompt() },
                { role: "user",   content: input.slice(0, 400) }
            ]
        });

        const out = String(resp.choices?.[0]?.message?.content || "").trim();
        return isNoSale(out) ? "" : out.split("\n")[0].trim();
    } catch (err) {
        console.error("AI_SALE_ERROR:", { message: err?.message, status: err?.status });
        throw mapAiError(err);
    }
}

module.exports = { normalizeSaleTextWithAI };
