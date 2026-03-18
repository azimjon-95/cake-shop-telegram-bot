const { mongoose } = require("../db");

const WorkerSchema = new mongoose.Schema(
    {
        tgId: { type: Number, unique: true, index: true, required: true },
        username: { type: String, default: "", index: true },
        fullName: { type: String, default: "" },

        role: { type: String, default: "worker" },
        canUseWebApp: { type: Boolean, default: true },
        isActive: { type: Boolean, default: true }
    },
    { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Worker", WorkerSchema);