const { mongoose } = require("../db");

const ReferralSchema = new mongoose.Schema(
    {
        inviterTgId: { type: Number, required: true, index: true },
        inviteeTgId: { type: Number, required: true, unique: true, index: true }, // 1 odam 1 marta
        createdAt: { type: Date, default: Date.now },
    },
    { versionKey: false }
);

module.exports = mongoose.model("Referral", ReferralSchema);