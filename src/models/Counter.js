const { mongoose } = require("../db");

const CounterSchema = new mongoose.Schema(
    {
        key: { type: String, unique: true, required: true }, // "balance"
        value: { type: Number, required: true, default: 0 }
    },
    { versionKey: false }
);

module.exports = mongoose.model("Counter", CounterSchema);
