const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    emailNorm: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    nome: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);