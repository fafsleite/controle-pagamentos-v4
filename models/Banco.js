const mongoose = require("mongoose");

const BancoSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    nome: { type: String, required: true },
  },
  { timestamps: true }
);

BancoSchema.index({ userId: 1, nome: 1 }, { unique: true });

module.exports = mongoose.models.Banco || mongoose.model("Banco", BancoSchema);