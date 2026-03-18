function escHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function normalizePhone(raw) {
    let p = String(raw ?? "").replace(/[^\d]/g, "");
    if (!p) return "";
    if (p.length === 9) p = "998" + p;
    return p;
}

function expenseCategoryTitle(categoryKey) {
    const map = {
        other: "Proche rasxodlar",
        rent: "Arenda",
        electricity: "Elektr energiya",
        supplier: "Firma (Taminotga)",
        cash: "Kapilka",
        worker: "Ishchiga",
        food: "Abetga",
        taxi: "Taksiga",
        repair: "Ustaga",
        bank: "Bank / Soliq to'lovlari"
    };

    return map[categoryKey] || "Chiqim";
}

function getVoiceFallbackText(err) {
    const code = String(err?.message || "");

    switch (code) {
        case "OPENAI_API_KEY_MISSING":
        case "OPENAI_AUTH_FAILED":
            return "⚠️ OpenAI sozlanmagan yoki API kalit noto‘g‘ri.\nAdmin hisobni tekshirsin.\nHozircha sotuvni yozma shaklda kiriting.";

        case "OPENAI_QUOTA_OR_LIMIT":
            return "⚠️ OpenAI limiti yoki balansi tugagan.\nIltimos, hisobni to‘ldiring.\nShundan keyin Ovoz orqali savdo qilish mumkin bo‘ladi.\nHozircha sotuvni yozma shaklda kiriting.";

        case "OPENAI_TEMP_UNAVAILABLE":
            return "⚠️ Voice xizmati vaqtincha ishlamayapti.\nBirozdan keyin qayta urinib ko‘ring.\nHozircha sotuvni yozma shaklda kiriting.";

        case "OPENAI_STT_FAILED":
        case "OPENAI_AI_FAILED":
            return "⚠️ Ovozli sotuvni tahlil qilib bo‘lmadi.\nIltimos, qayta urinib ko‘ring yoki yozma shaklda kiriting.";

        case "FFMPEG_FAILED":
        case "FFMPEG_NOT_INSTALLED":
            return "⚠️ Audio qayta ishlashda xatolik bo‘ldi.\nHozircha sotuvni yozma shaklda kiriting.";

        default:
            return "⚠️ Ovozli sotuv vaqtincha ishlamayapti.\nHozircha sotuvni yozma shaklda kiriting.";
    }
}

module.exports = {
    escHtml,
    normalizePhone,
    expenseCategoryTitle,
    getVoiceFallbackText
};