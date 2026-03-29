const mongoose = require("mongoose");

const ContaSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true, required: true },

    ano: { type: Number, required: true, index: true },
    mes: { type: Number, required: true, index: true },

    conta: { type: String, default: "" },
    descricao: { type: String, default: "" },
    categoria: { type: String, default: "" },
    tipo: { type: String, enum: ["fixo", "variavel"], default: "variavel" },
    vencimento: { type: String, default: null }, // mantém YYYY-MM-DD como hoje
    valor: { type: Number, default: 0 },
    banco: { type: String, default: "" },

    pago: { type: Boolean, default: false },
    status: { type: String, default: "Em aberto" },
    paidAt: { type: String, default: null },
  },
  { timestamps: true }
);

ContaSchema.index({ userId: 1, ano: 1, mes: 1 });
ContaSchema.index({ userId: 1, ano: 1, mes: 1, conta: 1, banco: 1, vencimento: 1 });

module.exports = mongoose.models.Conta || mongoose.model("Conta", ContaSchema);