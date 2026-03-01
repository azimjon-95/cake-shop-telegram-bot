const Referral = require("../models/Referral");
const Customer = require("../models/Customer");

function parseRefPayload(payload) {
    // payload: "ref_39464759"
    if (!payload) return null;
    const s = String(payload).trim();
    if (!s.startsWith("ref_")) return null;
    const id = Number(s.slice(4));
    if (!Number.isFinite(id) || id <= 0) return null;
    return id;
}

async function applyReferral({ inviterTgId, inviteeTgId }) {
    if (!inviterTgId || !inviteeTgId) return { ok: false, reason: "bad_ids" };
    if (inviterTgId === inviteeTgId) return { ok: false, reason: "self_ref" };

    // invitee faqat 1 marta
    const exists = await Referral.findOne({ inviteeTgId }).lean();
    if (exists) return { ok: false, reason: "already_used" };

    await Referral.create({ inviterTgId, inviteeTgId });

    // inviter referral count
    const count = await Referral.countDocuments({ inviterTgId });
    const newRefPoints = Math.floor(count / 3);

    const inviter = await Customer.findOne({ tgId: inviterTgId }).lean();
    const oldRefPoints = inviter?.refPoints || 0;

    const delta = newRefPoints - oldRefPoints; // yangi ball qancha qo‘shildi

    await Customer.findOneAndUpdate(
        { tgId: inviterTgId },
        {
            $set: { refCount: count, refPoints: newRefPoints, updatedAt: new Date() },
            ...(delta > 0 ? { $inc: { points: delta } } : {}), // umumiy ballga qo‘shamiz
        },
        { upsert: true, new: true }
    );

    return { ok: true, count, newRefPoints, delta };
}

function parseStartParam(startParam) {
    const s = String(startParam || "").trim();
    if (!s) return { kind: "none" };
    if (s.startsWith("ref_")) {
        const inviterTgId = Number(s.slice(4));
        if (Number.isFinite(inviterTgId) && inviterTgId > 0) {
            return { kind: "ref", inviterTgId };
        }
        return { kind: "ref_bad" };
    }
    return { kind: "token", token: s };
}

module.exports = { parseStartParam, parseRefPayload, applyReferral };