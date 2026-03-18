// src/services/aiSale.js
const { openai } = require("./openai");

function mapAiError(err) {
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

    return new Error("OPENAI_AI_FAILED");
}

async function normalizeSaleTextWithAI(rawText) {
    const input = String(rawText || "").trim();
    if (!input) return "";

    try {
        const resp = await openai.responses.create({
            model: process.env.OPENAI_MODEL || "gpt-5.4",
            input: [
                {
                    role: "system",
                    content: [
                        {
                            type: "text",
                            text:
                                "Siz sotuv matnini standartlashtirasiz. Faqat 1 qator toza natija qaytaring. Izoh yozmang. Format: Mahsulot 2ta 140000, Pepsi 1ta 17000, berdi 300000, tel 998..."
                        }
                    ]
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: input
                        }
                    ]
                }
            ]
        });

        return String(resp.output_text || "").trim();
    } catch (err) {
        console.error("AI_SALE_RAW_ERROR:", {
            message: err?.message,
            status: err?.status,
            code: err?.code,
            name: err?.name,
            response: err?.response?.data || null
        });

        throw mapAiError(err);
    }
}

module.exports = {
    normalizeSaleTextWithAI
};