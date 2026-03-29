require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const MONGODB_URI = process.env.MONGODB_URI || "";

const userSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => crypto.randomUUID(),
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    nome: { type: String, default: "" },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Mongo conectado");

  const email = "fafsleite@gmail.com".toLowerCase();
  const senha = "123456"; // troque aqui se quiser outra
  const hash = await bcrypt.hash(senha, 10);

  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      email,
      nome: "Usuário Pessoal",
      passwordHash: hash,
      isAdmin: false,
      ativo: true,
    });
    console.log("Usuário criado:", user.email);
  } else {
    user.passwordHash = hash;
    user.ativo = true;
    await user.save();
    console.log("Usuário atualizado:", user.email);
  }

  console.log("Senha definida para:", senha);

  await mongoose.disconnect();
  console.log("Finalizado");
}

main().catch(async (err) => {
  console.error("Erro:", err);
  try {
    await mongoose.disconnect();
  } catch {}
});