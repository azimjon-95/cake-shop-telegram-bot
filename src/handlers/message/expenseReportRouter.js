const dayjs = require("dayjs");
const { redis } = require("../../services/auth");
const {
    getDefaultRange,
    parseDateRange,
    getExpenseReportData,
    formatExpenseReportText
} = require("../../services/expenseReport");
const { expenseReportCategoryKeyboard } = require("../../keyboards");

function reportStateKey(userId) {
    return `expense_report_state:${userId}`;
}

async function saveReportState(userId, payload) {
    await redis.set(reportStateKey(userId), JSON.stringify(payload), "EX", 3600);
}

async function getReportState(userId) {
    const raw = await redis.get(reportStateKey(userId));
    return raw ? JSON.parse(raw) : null;
}

function mapTextToCategoryKey(text) {
    const map = {
        "🧾 Proche rasxodlar": "other",
        "🏠 Arenda": "rent",
        "⚡ Elektr energiya": "electricity",
        "🏷 Firma (Taminotga)": "supplier",
        "💰 Kapilka": "cash",
        "👷 Ishchiga": "worker",
        "🍽 Abetga": "food",
        "🚕 Taksiga": "taxi",
        "🛠 Ustaga": "repair",
        "🏦 Bank / Soliq to‘lovlari": "bank",
        "📊 Hammasi": "all"
    };

    return map[text] || null;
}

async function handleExpenseReportMenu(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = String(msg.text || "").trim();

    if (text === "💸 Chiqimlar hisobot") {
        await saveReportState(userId, {
            step: "choose_category"
        });

        await bot.sendMessage(
            chatId,
            "💸 Chiqimlar hisobot\n\nKategoriya tanlang:",
            { reply_markup: expenseReportCategoryKeyboard() }
        );
        return true;
    }

    const state = await getReportState(userId);
    const categoryKey = mapTextToCategoryKey(text);

    if (state?.step === "choose_category" && categoryKey) {
        const { from, to } = getDefaultRange();
        const data = await getExpenseReportData(from, to, categoryKey);

        await saveReportState(userId, {
            step: "range_or_txt",
            categoryKey,
            from: dayjs(from).toISOString(),
            to: dayjs(to).toISOString()
        });

        await bot.sendMessage(chatId, await formatExpenseReportText(data), {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📄 TXT yuklash", callback_data: "exp_report_txt" }]
                ]
            }
        });

        return true;
    }

    if (state?.step === "range_or_txt") {
        // 1) user boshqa kategoriya bosgan bo‘lsa, shu zahoti yangi kategoriya reporti ochilsin
        const newCategoryKey = mapTextToCategoryKey(text);
        if (newCategoryKey) {
            const { from, to } = getDefaultRange();
            const data = await getExpenseReportData(from, to, newCategoryKey);

            await saveReportState(userId, {
                step: "range_or_txt",
                categoryKey: newCategoryKey,
                from: dayjs(from).toISOString(),
                to: dayjs(to).toISOString()
            });

            await bot.sendMessage(chatId, await formatExpenseReportText(data), {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📄 TXT yuklash", callback_data: "exp_report_txt" }]
                    ]
                }
            });

            return true;
        }

        // 2) user sana yuborgan bo‘lsa, shu kategoriya uchun filtr qilamiz
        const range = parseDateRange(text);
        if (!range) return false;

        const data = await getExpenseReportData(range.from, range.to, state.categoryKey);

        await saveReportState(userId, {
            step: "range_or_txt",
            categoryKey: state.categoryKey,
            from: dayjs(range.from).toISOString(),
            to: dayjs(range.to).toISOString()
        });

        await bot.sendMessage(chatId, await formatExpenseReportText(data), {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📄 TXT yuklash", callback_data: "exp_report_txt" }]
                ]
            }
        });

        return true;
    }

    return false;
}

module.exports = {
    handleExpenseReportMenu,
    getReportState
};
