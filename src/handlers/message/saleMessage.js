const { MIN_QR_PAID } = require("../../config");
const { parseSaleMessage } = require("../../utils/parseSale");
const { itemsToText, deleteSaleKeyboard, printReceiptButton, mergeKeyboardsAbove } = require("../../logic/ui");
const { saveSaleWithTx } = require("../../logic/storage");
const { saleNotifyText } = require("../../utils/report");
const { sendToGroup } = require("../../services/notify");
const { createReceiptTokenIfNeeded } = require("../../services/receipt");
const { formatMoney } = require("../../utils/money");
const { normalizeSaleTextWithAI } = require("../../services/aiSale");
const { isLikelySaleText, saleWarningText } = require("../../services/saleGuard");

async function processSaleInput(bot, msg, rawInputText, seller, opts = {}) {
    const chatId = msg.chat.id;
    const tryAI = opts.tryAI !== false;

    const directParsed = parseSaleMessage(rawInputText);

    if (!directParsed.items.length) {
        if (!isLikelySaleText(rawInputText)) {
            return bot.sendMessage(chatId, saleWarningText());
        }

        if (!tryAI) {
            return bot.sendMessage(
                chatId,
                "⚠️ Sotuv matni tushunilmadi.\nIltimos aniqroq yozing.\n\nMisol:\nNapoleon 2ta 140000, Pepsi 1ta 17000"
            );
        }

        let normalizedText = "";
        try {
            normalizedText = await normalizeSaleTextWithAI(rawInputText);
        } catch (e) {
            console.error("SALE_AI_NORMALIZE_ERROR:", e);

            return bot.sendMessage(
                chatId,
                "⚠️ Sotuv matnini AI orqali tahlil qilib bo‘lmadi.\nIltimos yozuvni aniqroq kiriting.\n\nMisol:\nTort 120000, Perog 4ta 12000"
            );
        }

        const aiParsed = parseSaleMessage(normalizedText);

        if (!aiParsed.items.length) {
            return bot.sendMessage(
                chatId,
                "⚠️ Sotuvni aniqlab bo‘lmadi.\nIltimos yozma shaklda aniqroq kiriting.\n\nMisol:\nNapoleon 2ta 140000, Pepsi 1ta 17000"
            );
        }

        return saveParsedSale(bot, chatId, aiParsed, seller);
    }

    return saveParsedSale(bot, chatId, directParsed, seller);
}

async function saveParsedSale(bot, chatId, parsed, seller) {
    const itemsText = itemsToText(parsed.items);

    const { sale, debtDoc, change } = await saveSaleWithTx({
        seller,
        items: parsed.items,
        phone: parsed.phone,
        noteText: itemsText
    });

    const notify = saleNotifyText({
        sellerName: seller.tgName,
        itemsText,
        paidTotal: sale.paidTotal,
        debtTotal: sale.debtTotal,
        phone: sale.phone
    });

    const receiptToken = await createReceiptTokenIfNeeded({ sale, minPaid: MIN_QR_PAID });

    let webappUrl = null;
    if (receiptToken?.token && process.env.WEBAPP_URL) {
        const baseUrl = String(process.env.WEBAPP_URL).replace(/\/+$/, "");
        webappUrl = `${baseUrl}/receipt?token=${receiptToken.token}`;
    }

    const delKbd = deleteSaleKeyboard(sale._id);
    const mergedKbd = webappUrl
        ? mergeKeyboardsAbove(delKbd, printReceiptButton(webappUrl))
        : delKbd;

    await bot.sendMessage(
        chatId,
        `✅ <b>Sotuv saqlandi</b>\n🆔 ID: <code>${sale.orderNo}</code>\n` +
        `Tushgan: <b>${formatMoney(sale.paidTotal)}</b> so'm` +
        (sale.debtTotal > 0 ? `\nQarz: <b>${formatMoney(sale.debtTotal)}</b> so'm` : ""),
        { parse_mode: "HTML", ...mergedKbd }
    );

    await sendToGroup(bot, notify);

    if (debtDoc) {
        await bot.sendMessage(
            chatId,
            `📌 Qarz yaratildi: <b>${formatMoney(debtDoc.remainingDebt)}</b> so'm`,
            { parse_mode: "HTML" }
        );
    }

    if (change && change > 0) {
        await bot.sendMessage(
            chatId,
            `💵 Qaytim: <b>${formatMoney(change)}</b> so'm\n⚠️ Mijozga <b>${formatMoney(change)}</b> so'm qaytarib bering.`,
            { parse_mode: "HTML" }
        );
    }

    return true;
}

module.exports = { processSaleInput };