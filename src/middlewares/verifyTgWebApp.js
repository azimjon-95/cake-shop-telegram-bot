const crypto = require("crypto");

// Telegram WebApp initData validation
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
function verifyInitData(initData, botToken) {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false, reason: "no_hash" };

    params.delete("hash");

    const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    if (computedHash !== hash) return { ok: false, reason: "bad_hash" };

    const userRaw = params.get("user");
    let user = null;
    try { user = userRaw ? JSON.parse(userRaw) : null; } catch { }
    return { ok: true, user, params };
}

function verifyTgWebApp(botToken) {
    return (req, res, next) => {
        const initData = req.headers["x-telegram-init-data"] || "";
        const v = verifyInitData(initData, botToken);
        if (!v.ok) return res.status(401).json({ ok: false, error: "UNAUTHORIZED", reason: v.reason });
        req.tgUser = v.user;
        req.tgInit = v.params;
        next();
    };
}

module.exports = { verifyTgWebApp };
