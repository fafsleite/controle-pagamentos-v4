require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { connectMongo } = require("../lib/mongo");
const User = require("../models/User");
const Conta = require("../models/Conta");
const Saldo = require("../models/Saldo");
const Categoria = require("../models/Categoria");
const Banco = require("../models/Banco");

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseMonthKey(key) {
  // aceita "2026-03" ou "03/2026"
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [ano, mes] = key.split("-").map(Number);
    return { ano, mes };
  }
  if (/^\d{2}\/\d{4}$/.test(key)) {
    const [mes, ano] = key.split("/").map(Number);
    return { ano, mes };
  }
  return null;
}

async function main() {
  await connectMongo();

  const file = path.join(__dirname, "..", "db.json");
  if (!fs.existsSync(file)) {
    throw new Error(`db.json não encontrado em: ${file}`);
  }

  const raw = fs.readFileSync(file, "utf8");
  const db = JSON.parse(raw);

  const users = safeArray(db.users);
  const contas = safeArray(db.contas || db.accounts);
  const saldos = safeArray(db.saldos);
  const categorias = safeArray(db.categorias);
  const bancos = safeArray(db.bancos);

  const userMap = new Map();

  for (const u of users) {
    const email = String(u.email || "").trim();
    const emailNorm = normEmail(email);
    if (!emailNorm) continue;

    const doc = await User.findOneAndUpdate(
      { emailNorm },
      {
        $set: {
          email,
          emailNorm,
          passwordHash: u.passwordHash || u.password || "",
          nome: u.nome || "",
          isAdmin: !!u.isAdmin,
          ativo: u.ativo !== false,
        },
      },
      { new: true, upsert: true }
    );

    userMap.set(emailNorm, doc._id);
  }

  for (const c of categorias) {
    const emailNorm = normEmail(c.email || c.userEmail);
    const userId = userMap.get(emailNorm);
    if (!userId) continue;

    const nome = String(c.nome || c.categoria || "").trim();
    if (!nome) continue;

    await Categoria.updateOne(
      { userId, nome },
      { $setOnInsert: { userId, nome } },
      { upsert: true }
    );
  }

  for (const b of bancos) {
    const emailNorm = normEmail(b.email || b.userEmail);
    const userId = userMap.get(emailNorm);
    if (!userId) continue;

    const nome = String(b.nome || b.banco || "").trim();
    if (!nome) continue;

    await Banco.updateOne(
      { userId, nome },
      { $setOnInsert: { userId, nome } },
      { upsert: true }
    );
  }

  for (const s of saldos) {
    const emailNorm = normEmail(s.email || s.userEmail);
    const userId = userMap.get(emailNorm);
    if (!userId) continue;

    const ano = Number(s.ano);
    const mes = Number(s.mes);
    const banco = String(s.banco || "").trim();

    if (!ano || !mes || !banco) continue;

    await Saldo.updateOne(
      { userId, ano, mes, banco },
      {
        $set: {
          valor: Number(s.valor || 0),
        },
      },
      { upsert: true }
    );
  }

  // 1) formato em array simples
  for (const c of contas) {
    const emailNorm = normEmail(c.email || c.userEmail);
    const userId = userMap.get(emailNorm);
    if (!userId) continue;

    const ano = Number(c.ano);
    const mes = Number(c.mes);
    if (!ano || !mes) continue;

    await Conta.create({
      userId,
      ano,
      mes,
      conta: c.conta || c.descricao || "",
      descricao: c.descricao || c.conta || "",
      categoria: c.categoria || "",
      tipo: c.tipo === "fixo" ? "fixo" : "variavel",
      vencimento: c.vencimento || null,
      valor: Number(c.valor || 0),
      banco: c.banco || "",
      pago: !!c.pago,
      status: c.status || (c.pago ? "Pago" : "Em aberto"),
      paidAt: c.paidAt || null,
    });
  }

  // 2) formato legado por mês: db.meses["2026-03"] = [...]
  const meses = db.meses && typeof db.meses === "object" ? db.meses : null;
  if (meses) {
    for (const [monthKey, arr] of Object.entries(meses)) {
      const parsed = parseMonthKey(monthKey);
      if (!parsed) continue;
      const { ano, mes } = parsed;

      for (const c of safeArray(arr)) {
        const emailNorm = normEmail(c.email || c.userEmail);
        const userId = userMap.get(emailNorm);
        if (!userId) continue;

        await Conta.create({
          userId,
          ano,
          mes,
          conta: c.conta || c.descricao || "",
          descricao: c.descricao || c.conta || "",
          categoria: c.categoria || "",
          tipo: c.tipo === "fixo" ? "fixo" : "variavel",
          vencimento: c.vencimento || null,
          valor: Number(c.valor || 0),
          banco: c.banco || "",
          pago: !!c.pago,
          status: c.status || (c.pago ? "Pago" : "Em aberto"),
          paidAt: c.paidAt || null,
        });
      }
    }
  }

  console.log("Migração concluída com sucesso.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro na migração:", err);
  process.exit(1);
});