require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');

const MONGODB_URI = process.env.MONGODB_URI || '';
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'flavioleiteconsultoria@gmail.com').trim().toLowerCase();
const DBJSON_PATH = process.env.DBJSON_PATH || path.join(__dirname, 'db.json');

if (!MONGODB_URI) {
  console.error('Erro: MONGODB_URI não configurada no .env');
  process.exit(1);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v || '').trim()).filter(Boolean))];
}

function normalizeContas(contas) {
  if (!Array.isArray(contas)) return [];

  return contas.map((c) => {
    const pago =
      typeof c?.pago === 'string'
        ? ['1', 'true', 'sim', 'pago', 'yes'].includes(String(c.pago).trim().toLowerCase())
        : !!c?.pago;

    const paidAtIncoming = c?.pagoEm || c?.paidAt || null;
    const pagoEm = pago ? (paidAtIncoming || todayIso()) : null;

    return {
      conta: String(c?.conta || '').trim(),
      descricao: String(c?.descricao || '').trim(),
      categoria: String(c?.categoria || '').trim(),
      tipo: String(c?.tipo || 'fixo').trim() || 'fixo',
      vencimento: c?.vencimento || null,
      valor: Number(c?.valor || 0),
      banco: String(c?.banco || '').trim(),
      pago,
      pagoEm,
      status: pago ? 'Pago' : 'Em aberto',
      observacao: String(c?.observacao || '').trim(),
    };
  });
}

function deriveMonthBanks(userBanks, saldos, contas) {
  const fromSaldos = saldos && typeof saldos === 'object' ? Object.keys(saldos) : [];
  const fromContas = Array.isArray(contas) ? contas.map((c) => c?.banco) : [];
  return uniqueStrings([...(userBanks || []), ...fromSaldos, ...fromContas]);
}

function deriveMonthCategories(userCategories, contas) {
  const fromContas = Array.isArray(contas) ? contas.map((c) => c?.categoria) : [];
  return uniqueStrings([...(userCategories || []), ...fromContas]);
}

const userSchema = new mongoose.Schema(
  {
    _id: { type: String, default: () => crypto.randomUUID() },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailNorm: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    nome: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true },
    tema: { type: String, default: 'dark' },
    paleta: { type: String, default: 'azul' },
  },
  { timestamps: true }
);

const accountSchema = new mongoose.Schema(
  {
    conta: { type: String, default: '' },
    descricao: { type: String, default: '' },
    categoria: { type: String, default: '' },
    tipo: { type: String, default: 'fixo' },
    vencimento: { type: String, default: null },
    valor: { type: Number, default: 0 },
    banco: { type: String, default: '' },
    pago: { type: Boolean, default: false },
    pagoEm: { type: String, default: null },
    status: { type: String, default: 'em_aberto' },
    observacao: { type: String, default: '' },
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
    saldos: { type: Map, of: Number, default: {} },
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

const User = mongoose.models.User || mongoose.model('User', userSchema);
const MonthData = mongoose.models.MonthData || mongoose.model('MonthData', monthDataSchema);
const Meta = mongoose.models.Meta || mongoose.model('Meta', metaSchema);

async function main() {
  if (!fs.existsSync(DBJSON_PATH)) {
    throw new Error(`db.json não encontrado em: ${DBJSON_PATH}`);
  }

  const raw = fs.readFileSync(DBJSON_PATH, 'utf8');
  const db = JSON.parse(raw);

  await mongoose.connect(MONGODB_URI, { autoIndex: true });
  console.log('MongoDB conectado');

  const users = Array.isArray(db?.users) ? db.users : [];
  let importedUsers = 0;
  let importedMonths = 0;

  for (const legacyUser of users) {
    const email = normalizeEmail(legacyUser?.email);
    if (!email) continue;

    const isAdmin = String(legacyUser?.role || '').toUpperCase() === 'ADMIN' || email === ADMIN_EMAIL;
    const passwordHash = String(legacyUser?.password || '').trim();
    if (!passwordHash) {
      console.warn(`Usuário ignorado sem password hash: ${email}`);
      continue;
    }

    await User.findOneAndUpdate(
      { emailNorm: email },
      {
        $set: {
          email,
          emailNorm: email,
          nome: String(legacyUser?.nome || '').trim(),
          passwordHash,
          isAdmin,
          ativo: legacyUser?.ativo !== false,
          tema: String(legacyUser?.tema || 'dark').trim() || 'dark',
          paleta: String(legacyUser?.paleta || 'azul').trim() || 'azul',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    importedUsers += 1;

    const userBanks = uniqueStrings(legacyUser?.bancos || []);
    const userCategories = uniqueStrings(legacyUser?.categorias || []);
    const months = legacyUser?.data && typeof legacyUser.data === 'object' ? legacyUser.data : {};

    for (const [monthKey, monthValue] of Object.entries(months)) {
      const match = String(monthKey).match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        console.warn(`Mês ignorado (${email}): ${monthKey}`);
        continue;
      }

      const ano = Number(match[1]);
      const mes = Number(match[2]);
      const contas = normalizeContas(monthValue?.contas || []);
      const saldos = monthValue?.saldos && typeof monthValue.saldos === 'object' ? monthValue.saldos : {};
      const bancos = deriveMonthBanks(userBanks, saldos, contas);
      const categorias = deriveMonthCategories(userCategories, contas);
      const rev = Number(monthValue?.rev || 0) || 0;

      await MonthData.findOneAndUpdate(
        { ano, mes, ownerEmail: email },
        {
          $set: {
            ano,
            mes,
            ownerEmail: email,
            contas,
            bancos,
            categorias,
            saldos,
            rev,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      importedMonths += 1;
    }
  }

  const branding = db?.meta?.branding;
  if (branding && typeof branding === 'object') {
    await Meta.findOneAndUpdate(
      { key: 'branding' },
      {
        $set: {
          key: 'branding',
          value: {
            appName: String(branding?.appName || 'Controle de Pagamentos'),
            logoUrl: String(branding?.logoUrl || ''),
          },
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  console.log(`Usuários importados/atualizados: ${importedUsers}`);
  console.log(`Meses importados/atualizados: ${importedMonths}`);
  console.log('Branding importado:', !!branding);
  console.log('Migração concluída com sucesso.');
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Erro na migração:', err);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  });
