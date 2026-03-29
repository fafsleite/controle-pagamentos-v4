require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 10000);
const MONGODB_URI = process.env.MONGODB_URI || "";
const JWT_SECRET = process.env.JWT_SECRET || "123456";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "flavioleiteconsultoria@gmail.com").toLowerCase();
const MIN_PASSWORD_LENGTH = Number(process.env.MIN_PASSWORD_LENGTH || 4);

const FRONTEND_DIR = path.join(__dirname, "frontend");

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

console.log("Frontend dir:", FRONTEND_DIR);
console.log("API on", PORT);
console.log("ADMIN_EMAIL:", ADMIN_EMAIL);

/* =========================
   MongoDB
========================= */

mongoose
  .connect(MONGODB_URI, {
    autoIndex: true,
  })
  .then(() => {
    console.log("MongoDB conectado com sucesso");
  })
  .catch((err) => {
    console.error("Erro ao conectar no MongoDB:", err.message);
  });

/* =========================
   Schemas
========================= */

const userSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => crypto.randomUUID(),
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailNorm: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    nome: { type: String, default: "" },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true },
    tema: { type: String, default: "dark" },
    paleta: { type: String, default: "azul" },
  },
  { timestamps: true }
);

userSchema.pre("validate", function () {
  this.email = normalizeEmail(this.email);
  this.emailNorm = normalizeEmail(this.emailNorm || this.email);
});

const accountSchema = new mongoose.Schema(
  {
    conta: { type: String, default: "" },
    descricao: { type: String, default: "" },
    categoria: { type: String, default: "" },
    tipo: { type: String, default: "fixo" },
    vencimento: { type: String, default: null },
    valor: { type: Number, default: 0 },
    banco: { type: String, default: "" },
    pago: { type: Boolean, default: false },
    pagoEm: { type: String, default: null },
    status: { type: String, default: "em_aberto" },
    observacao: { type: String, default: "" },
  },
  { _id: false }
);

const monthDataSchema = new mongoose.Schema(
  {
    ano: { type: Number, required: true },
    mes: { type: Number, required: true },
    ownerEmail: { type: String, required: true, lowercase: true, trim: true },

    contas: { type: [accountSchema], default: [] },

    bancos: { type: [String], default: [] },
    categorias: { type: [String], default: [] },

    saldos: {
      type: Map,
      of: Number,
      default: {},
    },

    rev: { type: Number, default: 0 },
  },
  { timestamps: true }
);

monthDataSchema.index({ ano: 1, mes: 1, ownerEmail: 1 }, { unique: true });

const metaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const MonthData = mongoose.model("MonthData", monthDataSchema);
const Meta = mongoose.model("Meta", metaSchema);

/* =========================
   Helpers
========================= */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function userEmailQuery(email) {
  const norm = normalizeEmail(email);
  return { $or: [{ email: norm }, { emailNorm: norm }] };
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function roleFromUser(user) {
  return user?.isAdmin ? "ADMIN" : "USER";
}

async function getBrandingValue() {
  const branding = await Meta.findOne({ key: "branding" });
  return (
    branding?.value || {
      appName: "Controle de Pagamentos",
      logoUrl: "",
    }
  );
}

function signToken(user) {
  return jwt.sign(
    {
      id: String(user._id),
      email: user.email,
      isAdmin: !!user.isAdmin,
      role: roleFromUser(user),
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function repairUsersEmailNorm() {
  try {
    const users = await User.find({
      $or: [
        { emailNorm: { $exists: false } },
        { emailNorm: null },
        { emailNorm: "" },
      ],
    }).select("_id email emailNorm");

    let repaired = 0;
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (!email) continue;

      await User.updateOne(
        { _id: user._id },
        { $set: { email, emailNorm: email } }
      );
      repaired += 1;
    }

    if (repaired) {
      console.log(`PATCH V7: emailNorm reparado em ${repaired} usuário(s)`);
    }

    try {
      const indexes = await User.collection.indexes();
      const hasEmailNormIndex = indexes.some((idx) => idx && idx.name === "emailNorm_1");
      if (!hasEmailNormIndex) {
        await User.collection.createIndex({ emailNorm: 1 }, { unique: true, background: true, name: "emailNorm_1" });
      }
    } catch (err) {
      console.warn("PATCH V7: aviso ao garantir índice emailNorm_1:", err.message || err);
    }
  } catch (err) {
    console.error("PATCH V7: erro ao reparar emailNorm:", err);
  }
}

async function ensureAdminUser() {
  const adminEmail = normalizeEmail(ADMIN_EMAIL);
  if (!adminEmail) return;

  let admin = await User.findOne(userEmailQuery(adminEmail));

  if (!admin) {
    const defaultPassword = "123456";
    const hash = await bcrypt.hash(defaultPassword, 10);

    admin = await User.create({
      email: adminEmail,
      emailNorm: adminEmail,
      nome: "Administrador",
      passwordHash: hash,
      isAdmin: true,
      ativo: true,
      tema: "dark",
      paleta: "azul",
    });

    console.log(`Admin criado: ${adminEmail} | senha padrão: ${defaultPassword}`);
  } else if (!admin.isAdmin) {
    admin.isAdmin = true;
    await admin.save();
    console.log(`Usuário promovido a admin: ${adminEmail}`);
  }
}

async function getOrCreateMonth(ano, mes, ownerEmail) {
  let doc = await MonthData.findOne({ ano, mes, ownerEmail });

  if (!doc) {
    doc = await MonthData.create({
      ano,
      mes,
      ownerEmail,
      contas: [],
      bancos: [],
      categorias: [],
      saldos: {},
      rev: 0,
    });
  }

  return doc;
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido" });
  }
}

async function adminMiddleware(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: "Acesso negado" });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: "Erro ao validar admin" });
  }
}

async function sanitizeUser(user) {
  const branding = await getBrandingValue();
  return {
    id: String(user._id),
    email: user.email,
    nome: user.nome || "",
    isAdmin: !!user.isAdmin,
    role: roleFromUser(user),
    ativo: !!user.ativo,
    tema: user.tema || "dark",
    paleta: user.paleta || "azul",
    bancos: [],
    categorias: [],
    branding,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeContas(contas) {
  if (!Array.isArray(contas)) return [];

  return contas.map((c) => {
    const pago =
      typeof c.pago === "string"
        ? ["1", "true", "sim", "pago", "yes"].includes(String(c.pago).trim().toLowerCase())
        : !!c.pago;

    const paidAtIncoming = c.pagoEm || c.paidAt || null;
    const pagoEm = paidAtIncoming || (pago ? todayIso() : null);

    return {
      conta: c.conta || "",
      descricao: c.descricao || "",
      categoria: c.categoria || "",
      tipo: c.tipo || "fixo",
      vencimento: c.vencimento || null,
      valor: Number(c.valor || 0),
      banco: c.banco || "",
      pago,
      pagoEm: pago ? pagoEm : null,
      status: pago ? "Pago" : "Em aberto",
      observacao: c.observacao || "",
    };
  });
}

function publicConta(c) {
  const pago = !!c?.pago;
  const paidAt = c?.pagoEm || null;
  return {
    conta: c?.conta || "",
    descricao: c?.descricao || "",
    categoria: c?.categoria || "",
    tipo: c?.tipo || "fixo",
    vencimento: c?.vencimento || null,
    valor: Number(c?.valor || 0),
    banco: c?.banco || "",
    pago,
    pagoEm: paidAt,
    paidAt,
    status: pago ? "Pago" : "Em aberto",
    observacao: c?.observacao || "",
  };
}

function monthPayload(doc) {
  const saldos = doc?.saldos instanceof Map ? Object.fromEntries(doc.saldos) : Object.fromEntries(doc?.saldos || []);
  return {
    ano: doc.ano,
    mes: doc.mes,
    contas: Array.isArray(doc.contas) ? doc.contas.map(publicConta) : [],
    bancos: doc.bancos || [],
    categorias: doc.categorias || [],
    saldos: saldos || {},
    rev: doc.rev || 0,
    updatedAt: doc.updatedAt,
  };
}

function computeEtag(doc) {
  return `W/"${doc.rev || 0}-${doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now()}"`;
}

/* =========================
   Auth
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const senha = String(req.body.password || "");

    if (!email || !senha) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }

    let user = await User.findOne({ ...userEmailQuery(email), ativo: true });

    // Compatibilidade com o fluxo antigo da web:
    // se não existir, cria usuário comum com a própria senha informada.
    if (!user) {
      const passwordHash = await bcrypt.hash(senha, 10);
      user = await User.create({
        email,
        emailNorm: email,
        nome: "",
        passwordHash,
        isAdmin: email === ADMIN_EMAIL,
        ativo: true,
        tema: "dark",
        paleta: "azul",
      });
    } else {
      const ok = await bcrypt.compare(senha, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Usuário ou senha inválidos" });
      }
    }

    const token = signToken(user);

    return res.json({
      ok: true,
      token,
      user: await sanitizeUser(user),
    });
  } catch (err) {
    console.error("Erro no login:", err);
    return res.status(500).json({ error: "Erro interno no login" });
  }
});

app.get("/api/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user || !user.ativo) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const data = await sanitizeUser(user);

    return res.json({
      ...data,
      user: data,
    });
  } catch (err) {
    console.error("Erro em /api/me:", err);
    return res.status(500).json({ error: "Erro ao buscar usuário" });
  }
});

app.post("/api/change-password", authMiddleware, async (req, res) => {
  try {
    const atual = String(req.body.atual || "");
    const nova = String(req.body.nova || "");

    if (!atual || !nova) {
      return res.status(400).json({ error: "Senha atual e nova senha são obrigatórias" });
    }

    if (nova.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const ok = await bcrypt.compare(atual, user.passwordHash);

    if (!ok) {
      return res.status(401).json({ error: "Senha atual incorreta" });
    }

    user.passwordHash = await bcrypt.hash(nova, 10);
    await user.save();

    return res.json({ ok: true, message: "Senha alterada com sucesso" });
  } catch (err) {
    console.error("Erro ao trocar senha:", err);
    return res.status(500).json({ error: "Erro ao trocar senha" });
  }
});

/* =========================
   Users / Admin
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const nome = String(req.body.nome || "").trim();
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const exists = await User.findOne(userEmailQuery(email));
    if (exists) {
      return res.status(409).json({ error: "Já existe usuário com esse email" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      emailNorm: email,
      nome,
      passwordHash,
      isAdmin: false,
      ativo: true,
      tema: "dark",
      paleta: "azul",
    });

    return res.status(201).json({
      ok: true,
      user: await sanitizeUser(user),
    });
  } catch (err) {
    console.error("Erro ao registrar usuário:", err);
    return res.status(500).json({ error: "Erro ao registrar usuário" });
  }
});

// Compatibilidade com o admin antigo da web
app.post("/api/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email || req.body.login);
    const nome = String(req.body.nome || "").trim();
    const password = String(req.body.password || req.body.senha || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const exists = await User.findOne(userEmailQuery(email));
    if (exists) {
      return res.status(409).json({ error: "Já existe usuário com esse email" });
    }

    const user = await User.create({
      email,
      emailNorm: email,
      nome,
      passwordHash: await bcrypt.hash(password, 10),
      isAdmin: false,
      ativo: true,
      tema: "dark",
      paleta: "azul",
    });

    return res.status(201).json({
      ok: true,
      user: await sanitizeUser(user),
    });
  } catch (err) {
    console.error("Erro ao criar usuário no admin:", err);
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

app.get("/api/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    const mapped = await Promise.all(users.map((u) => sanitizeUser(u)));
    return res.json({ users: mapped });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    return res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

// Rota nova por id (mantida)
app.post("/api/admin/users/:id/reset-password", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const newPassword = String(req.body.newPassword || "123456");

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({
      ok: true,
      message: `Senha redefinida para ${user.email}`,
    });
  } catch (err) {
    console.error("Erro ao resetar senha:", err);
    return res.status(500).json({ error: "Erro ao resetar senha" });
  }
});

// Compatibilidade antiga por email
app.put("/api/admin/users/:email/password", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const email = normalizeEmail(req.params.email);
    const newPassword = String(req.body.password || req.body.newPassword || "");

    if (!email || !newPassword) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres` });
    }

    const user = await User.findOne(userEmailQuery(email));
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({
      ok: true,
      message: `Senha redefinida para ${user.email}`,
    });
  } catch (err) {
    console.error("Erro ao resetar senha por email:", err);
    return res.status(500).json({ error: "Erro ao resetar senha" });
  }
});

// Rota nova por id (mantida)
app.delete("/api/admin/users/:ref", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const ref = String(req.params.ref || "").trim();

    let user = null;

    if (ref.includes("@")) {
      user = await User.findOne({ email: normalizeEmail(ref) });
    } else {
      user = await User.findById(ref);
      if (!user) {
        user = await User.findOne({ email: normalizeEmail(ref) });
      }
    }

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    if (normalizeEmail(user.email) === ADMIN_EMAIL) {
      return res.status(400).json({ error: "Não é permitido excluir o administrador principal" });
    }

    await MonthData.deleteMany({ ownerEmail: user.email });
    await User.deleteOne({ _id: user._id });

    return res.json({
      ok: true,
      message: `Usuário apagado com sucesso: ${user.email}`,
    });
  } catch (err) {
    console.error("Erro ao apagar usuário:", err);
    return res.status(500).json({ error: "Erro ao apagar usuário" });
  }
});

/* =========================
   Branding / Meta
========================= */

app.get("/api/branding", async (req, res) => {
  try {
    const branding = await getBrandingValue();
    return res.json({ branding });
  } catch (err) {
    console.error("Erro ao buscar branding:", err);
    return res.status(500).json({ error: "Erro ao buscar branding" });
  }
});

// Compatibilidade com web antiga
app.get("/api/public/branding", async (req, res) => {
  try {
    const branding = await getBrandingValue();
    return res.json(branding);
  } catch (err) {
    console.error("Erro ao buscar branding público:", err);
    return res.status(500).json({ error: "Erro ao buscar branding" });
  }
});

app.put("/api/branding", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const current = (await Meta.findOne({ key: "branding" })) || new Meta({ key: "branding", value: {} });

    current.value = {
      appName: String(req.body.appName || "Controle de Pagamentos"),
      logoUrl: String(req.body.logoUrl || ""),
    };

    await current.save();

    return res.json({ ok: true, branding: current.value });
  } catch (err) {
    console.error("Erro ao salvar branding:", err);
    return res.status(500).json({ error: "Erro ao salvar branding" });
  }
});

// Compatibilidade com web antiga
app.put("/api/admin/branding", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const current = (await Meta.findOne({ key: "branding" })) || new Meta({ key: "branding", value: {} });

    current.value = {
      appName: String(req.body.appName || "Controle de Pagamentos"),
      logoUrl: String(req.body.logoUrl || ""),
    };

    await current.save();

    return res.json({
      ok: true,
      branding: current.value,
      message: "Branding salvo com sucesso",
    });
  } catch (err) {
    console.error("Erro ao salvar branding admin:", err);
    return res.status(500).json({ error: "Erro ao salvar branding" });
  }
});

/* =========================
   Settings do usuário
========================= */

app.get("/api/settings", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res.json({
      tema: user.tema || "dark",
      paleta: user.paleta || "azul",
    });
  } catch (err) {
    console.error("Erro ao buscar settings:", err);
    return res.status(500).json({ error: "Erro ao buscar settings" });
  }
});

app.put("/api/settings", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    if (req.body.tema != null) user.tema = String(req.body.tema || "dark");
    if (req.body.paleta != null) user.paleta = String(req.body.paleta || "azul");

    await user.save();

    return res.json({
      ok: true,
      tema: user.tema,
      paleta: user.paleta,
    });
  } catch (err) {
    console.error("Erro ao salvar settings:", err);
    return res.status(500).json({ error: "Erro ao salvar settings" });
  }
});

/* =========================
   Data do mês
========================= */

app.get("/api/data/:ano/:mes", authMiddleware, async (req, res) => {
  try {
    const ano = Number(req.params.ano);
    const mes = Number(req.params.mes);
    const ownerEmail = normalizeEmail(req.user.email);

    const doc = await getOrCreateMonth(ano, mes, ownerEmail);
    const etag = computeEtag(doc);

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    res.setHeader("ETag", etag);

    return res.json(monthPayload(doc));
  } catch (err) {
    console.error("Erro ao buscar dados do mês:", err);
    return res.status(500).json({ error: "Erro ao buscar dados do mês" });
  }
});

app.put("/api/data/:ano/:mes", authMiddleware, async (req, res) => {
  try {
    const ano = Number(req.params.ano);
    const mes = Number(req.params.mes);
    const ownerEmail = normalizeEmail(req.user.email);

    const contas = normalizeContas(req.body.contas);
    const bancos = Array.isArray(req.body.bancos) ? req.body.bancos.map(String) : [];
    const categorias = Array.isArray(req.body.categorias) ? req.body.categorias.map(String) : [];
    const saldos = req.body.saldos && typeof req.body.saldos === "object" ? req.body.saldos : {};

    const hasRev =
      req.body.rev !== undefined && req.body.rev !== null && req.body.rev !== "";
    const clientRev = hasRev ? Number(req.body.rev) : null;

    const doc = await getOrCreateMonth(ano, mes, ownerEmail);

    // Compatibilidade: só exige rev se a web enviar rev.
    if (hasRev && (doc.rev || 0) !== clientRev) {
      const current = monthPayload(doc);
      return res.status(409).json({
        error: "Conflito de revisão",
        current,
        data: current,
      });
    }

    doc.contas = contas;
    doc.bancos = bancos;
    doc.categorias = categorias;
    doc.saldos = saldos;
    doc.rev = (doc.rev || 0) + 1;

    await doc.save();

    const payload = monthPayload(doc);
    const etag = computeEtag(doc);
    res.setHeader("ETag", etag);

    // devolve compatível com modelos antigo e novo
    return res.json({
      ok: true,
      ...payload,
      data: payload,
    });
  } catch (err) {
    console.error("Erro ao salvar dados do mês:", err);
    return res.status(500).json({ error: "Erro ao salvar dados do mês" });
  }
});

app.delete("/api/data/:ano/:mes", authMiddleware, async (req, res) => {
  try {
    const ano = Number(req.params.ano);
    const mes = Number(req.params.mes);
    const ownerEmail = normalizeEmail(req.user.email);

    await MonthData.deleteOne({ ano, mes, ownerEmail });

    return res.json({ ok: true, message: "Mês removido com sucesso" });
  } catch (err) {
    console.error("Erro ao apagar mês:", err);
    return res.status(500).json({ error: "Erro ao apagar mês" });
  }
});

/* =========================
   Health
========================= */

app.get("/api/health", async (req, res) => {
  const mongoState = mongoose.connection.readyState;
  return res.json({
    ok: true,
    mongoState,
  });
});

/* =========================
   Frontend estático
========================= */

app.use(express.static(FRONTEND_DIR));

app.get("*", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

/* =========================
   Start
========================= */

mongoose.connection.once("open", async () => {
  try {
    await repairUsersEmailNorm();
    await ensureAdminUser();
    console.log(`PATCH V8 SENHA SIMPLES ATIVO | mínimo ${MIN_PASSWORD_LENGTH} caracteres`);

    app.listen(PORT, () => {
      console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Erro ao inicializar servidor:", err);
    process.exit(1);
  }
});