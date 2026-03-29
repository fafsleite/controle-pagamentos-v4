const mongoose = require("mongoose");

const CategoriaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },
    nome: { type: String, required: true },
  },
  { timestamps: true }
);

CategoriaSchema.index({ userId: 1, nome: 1 }, { unique: true });

module.exports = mongoose.models.Categoria || mongoose.model("Categoria", CategoriaSchema);