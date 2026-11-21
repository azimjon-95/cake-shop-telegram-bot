const { mainMenuKeyboard, startKeyboard, webAppButtons } = require("../../keyboards");
const { WEBAPP_URL } = require("../../config");
const { isAuthed, setMode, getUserBranch, loginByPin, autoLogin, redis } = require("../../services/auth");
const { branchName, getBranches } = require("../../services/branches");
const { ADMIN_TG_ID } = require("../../config");

const PIN_PROMPT = "🔑 Do'kon PIN-kodini kiriting:";

function readyText(branchId) {
    return `🧁 Bot tayyor.\n🏪 Filial: <b>${branchName(branchId)}</b>\nSotuvni yozishingiz yoki voice yuborishingiz mumkin.`;
}

function blockedText(ms) {
    return `⛔ Juda ko'p noto'g'ri urinish. ${Math.ceil(ms / 60000)} daqiqadan keyin qayta urinib ko'ring.`;
}

async function handleTopCommands(bot, msg) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();

    if (text === "/tozalash") {
        await Promise.all([
            redis.del(`await_pay_amount:${userId}`),
            redis.del(`await_del:${userId}`),
            redis.del(`pur_state:${userId}`),
            redis.del(`exp_state:${userId}`),
            redis.del(`await_cashback:${userId}`),
        ]);

        await setMode(userId, "sale");
        await bot.sendMessage(
            chatId,
            "🧹 Bekor qilindi. Endi sotuvni yozishingiz yoki voice yuborishingiz mumkin.",
            { reply_markup: mainMenuKeyboard() }
        );
        return true;
    }

    if (text === "/start") {
        const ok = await isAuthed(userId);
        if (ok) {
            const branch = await getUserBranch(userId);
            await setMode(userId, "sale");
            const waUrl  = WEBAPP_URL;
            const waBtns = webAppButtons(waUrl);

            await bot.sendMessage(
                chatId,
                `🧁 Bot tayyor!\n🏪 Filial: <b>${branchName(branch)}</b>`,
                { parse_mode: "HTML", reply_markup: mainMenuKeyboard() }
            );

            // WebApp va Offline tugmalari
            if (waBtns) {
                const waText =
                    "📱 Ilova:\n" +
                    "• Dashboard — real-time hisobot\n" +
                    "• Offline rejim — internet uzilsa ham sotuv\n\n" +
                    "Offline rejimni yuklab oling!";
                await bot.sendMessage(chatId, waText, {
                    parse_mode: "HTML",
                    reply_markup: waBtns,
                });
            }
            return true;
        }

        // Oldin PIN bilan kirgan xodim — PIN so'ramasdan
        const auto = await autoLogin(userId);
        if (auto.ok) {
            await setMode(userId, "sale");
            await bot.sendMessage(chatId, readyText(auto.branch), {
                parse_mode: "HTML",
                reply_markup: mainMenuKeyboard(),
            });
            return true;
        }

        await setMode(userId, "await_password");
        await bot.sendMessage(chatId, PIN_PROMPT);
        return true;
    }

    // Admin: filialni PIN siz almashtirish
    if (text === "/filial") {
        if (!ADMIN_TG_ID || Number(userId) !== Number(ADMIN_TG_ID)) return true;
        const cur = await getUserBranch(userId);
        const rows = Object.values(getBranches()).map(b => ([{
            text: (b.id === cur ? "✅ " : "") + b.name,
            callback_data: `branch_switch:${b.id}`,
        }]));
        await bot.sendMessage(chatId, `🏪 Joriy filial: <b>${branchName(cur)}</b>\nAlmashtirish:`, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
        });
        return true;
    }

    if (text.startsWith("/")) {
        return true;
    }

    return false;
}

async function handlePasswordStep(bot, msg, mode) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = String(msg.text || "").trim();

    if (mode !== "await_password") return false;

    const r = await loginByPin(userId, text);
    if (r.ok) {
        await setMode(userId, "sale");
        await bot.sendMessage(chatId, readyText(r.branch), {
            parse_mode: "HTML",
            reply_markup: mainMenuKeyboard(),
        });
        return true;
    }

    if (r.blockedMs > 0) {
        await bot.sendMessage(chatId, blockedText(r.blockedMs));
        return true;
    }

    await bot.sendMessage(chatId, "❌ PIN noto‘g‘ri. Qayta kiriting:");
    return true;
}

module.exports = { handleTopCommands, handlePasswordStep, PIN_PROMPT };