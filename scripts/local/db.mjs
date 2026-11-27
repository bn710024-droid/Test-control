/**
 * BASE LOCALE DE DÉVELOPPEMENT — remplace le client Supabase quand la tour tourne sur un poste
 * sans accès à la base (scripts/local/server.mjs). Jamais utilisée en production : le serveur
 * local redirige l'import de `api/db-client.js` vers ce fichier, rien d'autre ne le charge.
 *
 * Les tables vivent en mémoire et sont recopiées dans `.local-db/db.json` à chaque écriture.
 * Seules les opérations réellement utilisées par les routes /api sont couvertes : select (avec
 * count/head), eq, neq, in, gt, gte, lt, lte, is, order, limit, range, single, maybeSingle,
 * insert, upsert (onConflict), update, delete. Stockage : upload, getPublicUrl, remove,
 * createSignedUploadUrl. Authentification : aucune (accès ouvert en phase de test).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.TOWER_LOCAL_DIR || path.resolve(process.cwd(), '.local-db');
const FILE = path.join(ROOT, 'db.json');
const STORAGE = path.join(ROOT, 'storage');
const PUBLIC_BASE = process.env.TOWER_LOCAL_URL || 'http://localhost:3000';

const KEYS = { settings: 'key', seals: 'ref' };
const SERIAL = new Set(['journal', 'rate_hits']);
const keyOf = (table) => KEYS[table] || 'id';

let tables = {};
try {
  tables = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  tables = {};
}

let pending = null;
function persist() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(tables));
  }, 30);
}

const rowsOf = (table) => (tables[table] ||= []);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : a < b ? -1 : 1);
const comparable = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).getTime() : v);

function pick(row, columns) {
  if (!columns || columns.trim() === '*') return clone(row);
  const out = {};
  for (const c of columns.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = clone(row[c]);
  return out;
}

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.columns = '*';
    this.filters = [];
    this.orders = [];
    this.lim = null;
    this.from = 0;
    this.mode = 'many';
    this.countMode = null;
    this.head = false;
    this.payload = null;
    this.returning = false;
  }
  select(columns = '*', opts = {}) {
    if (this.op === 'select') {
      this.columns = columns;
      this.countMode = opts.count || null;
      this.head = !!opts.head;
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(rows) {
    this.op = 'insert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows, opts = {}) {
    this.op = 'upsert';
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = opts.onConflict || keyOf(this.table);
    this.ignore = !!opts.ignoreDuplicates;
    return this;
  }
  update(patch) {
    this.op = 'update';
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
  in(c, list) { const s = new Set(list); this.filters.push((r) => s.has(r[c])); return this; }
  is(c, v) { this.filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return this; }
  gt(c, v) { this.filters.push((r) => comparable(r[c]) > comparable(v)); return this; }
  gte(c, v) { this.filters.push((r) => comparable(r[c]) >= comparable(v)); return this; }
  lt(c, v) { this.filters.push((r) => comparable(r[c]) < comparable(v)); return this; }
  lte(c, v) { this.filters.push((r) => comparable(r[c]) <= comparable(v)); return this; }
  order(c, opts = {}) { this.orders.push([c, opts.ascending !== false]); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.from = a; this.lim = b - a + 1; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(resolve, reject) {
    try {
      resolve(this.run());
    } catch (err) {
      reject ? reject(err) : resolve({ data: null, error: { message: String(err?.message || err) } });
    }
  }
  matching() {
    return rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
  }
  finish(list) {
    let data = list;
    if (this.mode === 'single') {
      if (data.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      return { data: data[0], error: null };
    }
    if (this.mode === 'maybe') return { data: data[0] ?? null, error: null };
    return { data, error: null };
  }
  stamp(row, isNew) {
    const now = new Date().toISOString();
    const out = { ...row };
    if (isNew && SERIAL.has(this.table) && out.id === undefined) {
      const ids = rowsOf(this.table).map((r) => Number(r.id) || 0);
      out.id = (ids.length ? Math.max(...ids) : 0) + 1;
    }
    if (isNew) {
      if (this.table === 'orders' && out.received_at === undefined) out.received_at = now;
      if (this.table === 'rate_hits' && out.at === undefined) out.at = now;
      if (this.table === 'journal' && out.at === undefined) out.at = now;
      if (this.table === 'seals' && out.sealed_at === undefined) out.sealed_at = now;
      if (!['orders', 'rate_hits', 'journal', 'seals', 'settings', 'packagings', 'zones'].includes(this.table) && out.created_at === undefined) out.created_at = now;
      if (!['rate_hits', 'journal', 'seals'].includes(this.table) && out.updated_at === undefined && this.table !== 'orders') out.updated_at = now;
    }
    return out;
  }
  run() {
    const all = rowsOf(this.table);
    if (this.op === 'select') {
      let list = this.matching();
      for (const [c, asc] of [...this.orders].reverse()) {
        list = [...list].sort((a, b) => (asc ? 1 : -1) * cmp(comparable(a[c]), comparable(b[c])));
      }
      const count = list.length;
      if (this.from) list = list.slice(this.from);
      if (this.lim !== null) list = list.slice(0, this.lim);
      if (this.head) return { data: null, count, error: null };
      const res = this.finish(list.map((r) => pick(r, this.columns)));
      return this.countMode ? { ...res, count } : res;
    }
    if (this.op === 'insert') {
      const key = keyOf(this.table);
      const made = [];
      for (const raw of this.payload) {
        const row = this.stamp(clone(raw), true);
        if (row[key] !== undefined && all.some((r) => r[key] === row[key])) {
          return { data: null, error: { message: `duplicate key value violates unique constraint (${this.table}.${key})`, code: '23505' } };
        }
        all.push(row);
        made.push(row);
      }
      persist();
      return this.returning ? this.finish(made.map((r) => pick(r, this.columns))) : { data: null, error: null };
    }
    if (this.op === 'upsert') {
      const key = this.conflict;
      const made = [];
      for (const raw of this.payload) {
        const at = all.findIndex((r) => r[key] === raw[key]);
        if (at >= 0) {
          if (this.ignore) continue;
          all[at] = { ...all[at], ...clone(raw) };
          made.push(all[at]);
        } else {
          const row = this.stamp(clone(raw), true);
          all.push(row);
          made.push(row);
        }
      }
      persist();
      return this.returning ? this.finish(made.map((r) => pick(r, this.columns))) : { data: null, error: null };
    }
    if (this.op === 'update') {
      const hit = this.matching();
      for (const r of hit) Object.assign(r, clone(this.payload));
      persist();
      return this.returning ? this.finish(hit.map((r) => pick(r, this.columns))) : { data: null, error: null };
    }
    if (this.op === 'delete') {
      const hit = new Set(this.matching());
      tables[this.table] = all.filter((r) => !hit.has(r));
      persist();
      return this.returning ? this.finish([...hit].map((r) => pick(r, this.columns))) : { data: null, error: null };
    }
    return { data: null, error: { message: `opération inconnue ${this.op}` } };
  }
}

const safe = (p) => String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '..' && s !== '.').join('/');

function bucket(name) {
  const dir = path.join(STORAGE, safe(name));
  return {
    async upload(p, body) {
      const file = path.join(dir, safe(p));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const buf = Buffer.isBuffer(body) ? body : body instanceof ArrayBuffer ? Buffer.from(body) : Buffer.from(await new Response(body).arrayBuffer());
      fs.writeFileSync(file, buf);
      return { data: { path: p }, error: null };
    },
    getPublicUrl(p) {
      return { data: { publicUrl: `${PUBLIC_BASE}/_storage/${safe(name)}/${safe(p)}` } };
    },
    async remove(paths) {
      for (const p of paths || []) fs.rmSync(path.join(dir, safe(p)), { force: true });
      return { data: [], error: null };
    },
    async createSignedUploadUrl(p) {
      return { data: { signedUrl: `${PUBLIC_BASE}/_storage-upload/${safe(name)}/${safe(p)}`, token: 'local', path: p }, error: null };
    },
  };
}

const supabase = {
  from: (table) => new Query(table),
  storage: { from: bucket },
  auth: {
    async getUser() {
      return { data: { user: null }, error: { message: 'Pas d’authentification en local.' } };
    },
    admin: {
      async listUsers() {
        return { data: { users: [] }, error: null };
      },
      async updateUserById() {
        return { data: { user: null }, error: { message: 'Pas d’authentification en local.' } };
      },
    },
  },
};

export const LOCAL_STORAGE_DIR = STORAGE;
export default supabase;
