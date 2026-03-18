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

async function normalizeExpenseVoiceText(rawText) {
    const input = String(rawText || "").trim();
    if (!input) return null;

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
                                'Siz chiqim ovozli matnini JSONga aylantirasiz. Faqat JSON qaytaring. categoryKey faqat quyidagilardan biri bo‘lsin: "other","rent","electricity","supplier","worker","food","taxi","repair","bank","cash". amount son bo‘lsin. description bo‘lsa string, bo‘lmasa "".'
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

        const txt = String(resp.output_text || "").trim();
        return JSON.parse(txt);
    } catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error("OPENAI_AI_FAILED");
        }
        throw mapAiError(err);
    }
}

module.exports = {
    normalizeExpenseVoiceText
};