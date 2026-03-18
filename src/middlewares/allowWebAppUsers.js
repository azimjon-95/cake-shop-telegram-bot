const Worker = require("../models/Worker");

async function allowWebAppUsers(req, res, next) {
    const tgId = Number(req?.tgUser?.id);

    if (!tgId) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED", reason: "no_tg_user" });
    }

    const worker = await Worker.findOne({
        tgId,
        isActive: true,
        canUseWebApp: true,
    }).lean();

    if (!worker) {
        return res.status(403).json({ ok: false, error: "FORBIDDEN", reason: "no_access" });
    }

    req.worker = worker;
    next();
}

module.exports = { allowWebAppUsers };