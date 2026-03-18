const { mongoose } = require("../db");

const SeenTelegramUserSchema = new mongoose.Schema(
    {
        tgId: { type: Number, unique: true, index: true },
        username: { type: String, default: "", index: true },
        fullName: { type: String, default: "" },
        lastSeenAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model("SeenTelegramUser", SeenTelegramUserSchema);