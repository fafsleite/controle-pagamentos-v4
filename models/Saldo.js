const mongoose = require("mongoose");

const SaldoSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    ano: { type: Number, required: true, index: true },
    mes: { type: Number, required: true, index: true },
    banco: { type: String, required: true },
    valor: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SaldoSchema.index({ userId: 1, ano: 1, mes: 1, banco: 1 }, { unique: true });

module.exports = mongoose.models.Saldo || mongoose.model("Saldo", SaldoSchema);