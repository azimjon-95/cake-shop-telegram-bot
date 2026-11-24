#!/usr/bin/env node
// Production oldidan tekshiruv: env, ffmpeg, OpenAI kalit va model ruxsati;
// ixtiyoriy: haqiqiy audio namunalar bilan aniqlikni baholash (HECH NARSA SAQLANMAYDI).
//
//   node scripts/voice-check.js                 → sozlama + model ruxsati
//   node scripts/voice-check.js samples/        → + samples/cases.json bo'yicha aniqlik hisoboti
//
// Qabul mezoni: "XATO AVTOMATIK" = 0 (noto'g'ri summa hech qachon tasdiqsiz saqlanmasligi kerak).

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

(async () => {
    const { validateVoiceConfig } = require("../src/services/voiceConfig");
    const { openai, hasKey } = require("../src/services/openai");
    const cfg = validateVoiceConfig();
    let fatal = 0;
    const line = (okFlag, msg) => { console.log(`${okFlag ? "✅" : "❌"} ${msg}`); if (!okFlag) fatal++; };

    console.log("── Sozlamalar ──");
    console.log(`STT model: ${cfg.sttModel} | Chat model: ${cfg.chatModel} | til: ${cfg.sttLanguage || "avtomatik"}`);
    console.log(`maxSec=${cfg.maxSec} minSec=${cfg.minSec} maxFileMb=${cfg.maxFileMb} timeout=${cfg.processTimeoutMs}ms retries=${cfg.maxRetries} concurrency=${cfg.userConcurrency}`);

    try { const v = execFileSync(cfg.ffmpegPath, ["-version"]).toString().split("\n")[0]; line(true, `ffmpeg: ${v}`); }
    catch { line(false, `ffmpeg topilmadi (FFMPEG_PATH=${cfg.ffmpegPath})`); }

    line(hasKey(), "OPENAI_API_KEY mavjud");
    if (hasKey()) {
        for (const m of [cfg.sttModel, cfg.chatModel]) {
            try { await openai.models.retrieve(m, { timeout: 15000 }); line(true, `model ruxsati bor: ${m}`); }
            catch (e) { line(false, `model ${m}: ${e?.status || ""} ${String(e?.message || "").replace(/sk-[\w*-]+/g, "sk-***").slice(0, 120)}`); }
        }
    }

    const dir = process.argv[2];
    if (dir) {
        const casesPath = path.join(dir, "cases.json");
        if (!fs.existsSync(casesPath)) { line(false, `${casesPath} yo'q (namuna: samples/cases.example.json)`); }
        else await evaluate(dir, JSON.parse(fs.readFileSync(casesPath, "utf8")), cfg, (o, m) => line(o, m));
    }

    console.log(fatal ? `\n❌ ${fatal} ta muammo` : "\n✅ Hammasi joyida");
    process.exit(fatal ? 1 : 0);
})().catch(e => { console.error("CRASH", e?.code || e?.message); process.exit(2); });

async function evaluate(dir, cases, cfg, line) {
    const { transcribeLocalFile } = require("../src/services/stt");
    const { normalizeSaleTextWithAI } = require("../src/services/aiSale");
    const { normalizeExpenseVoiceText } = require("../src/services/aiExpense");
    const { _internals: R } = require("../src/handlers/message/voiceRouter");
    const { parseSaleMessage } = require("../src/utils/parseSale");

    console.log(`\n── Aniqlik: ${cases.length} ta namuna ──`);
    const stat = { correctAuto: 0, confirm: 0, wrongAuto: 0, rejected: 0, error: 0 };

    for (const c of cases) {
        const tag = `[${c.lang || "?"}/${c.kind}] ${c.file}`;
        try {
            const spoken = await transcribeLocalFile(path.join(dir, c.file), { kind: c.kind });
            let auto = false, correct = false, shown = "";
            if (c.kind === "sale") {
                const norm = R.looksLikeSaleSpeech(spoken) ? await normalizeSaleTextWithAI(spoken) : "";
                shown = norm || "(sotuv emas)";
                if (norm) {
                    auto = R.verifySale(spoken, norm).ok;
                    const got = parseSaleMessage(norm).items.map(i => [i.price, i.qty]).sort().join("|");
                    const exp = (c.expect?.items || []).map(i => [i.price, i.qty || 1]).sort().join("|");
                    correct = got === exp;
                } else correct = !c.expect?.items?.length;
            } else {
                const d = await normalizeExpenseVoiceText(spoken);
                shown = d ? JSON.stringify(d) : "(aniqlanmadi)";
                if (d) { auto = R.verifyExpense(spoken, d).ok; correct = d.amount === c.expect?.amount && d.categoryKey === c.expect?.categoryKey; }
                else correct = !c.expect;
            }
            const verdict = !shown || shown.startsWith("(") ? (correct ? "rejected" : "rejected") : auto ? (correct ? "correctAuto" : "wrongAuto") : "confirm";
            stat[verdict]++;
            console.log(`${verdict === "wrongAuto" ? "🚨" : verdict === "correctAuto" ? "✅" : "🟡"} ${tag}\n    🎤 ${spoken}\n    → ${shown}  [${verdict}${correct ? "" : ", kutilgan bilan mos emas"}]`);
        } catch (e) {
            stat.error++; console.log(`❌ ${tag}: ${e?.code || e?.message}`);
        }
    }
    console.log(`\nTo'g'ri avtomatik: ${stat.correctAuto} | Tasdiq so'raldi: ${stat.confirm} | Rad etildi: ${stat.rejected} | Xato: ${stat.error} | 🚨 XATO AVTOMATIK: ${stat.wrongAuto}`);
    line(stat.wrongAuto === 0, "Noto'g'ri summa tasdiqsiz saqlanadigan holat yo'q");
}
