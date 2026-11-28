/**
 * TOUR DE CONTRÔLE EN LOCAL, SANS SUPABASE — `npm run local` (http://localhost:3000).
 *
 * Pour développer et tester sur un poste qui n'a pas les variables Supabase : les routes /api
 * (fonctions Vercel) tournent telles quelles, mais `api/db-client.js` est remplacé par une base
 * locale (scripts/local/db.mjs, fichier `.local-db/db.json`, ignoré par Git). Le front (Vite) est
 * servi sur le même port, comme avec `vercel dev`.
 *
 * Jamais utilisé en production. Avec les vraies variables, utiliser `npx vercel dev`.
 * Remise à zéro : supprimer le dossier `.local-db`.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const dataDir = path.join(root, '.local-db');
const PORT = Number(process.env.PORT || 3000);
process.env.TOWER_LOCAL_DIR = dataDir;
process.env.TOWER_LOCAL_URL ||= `http://localhost:${PORT}`;

// Secrets propres au poste (scellés, coffre des commandes) : créés une fois, gardés dans .local-db.
fs.mkdirSync(dataDir, { recursive: true });
const secretFile = path.join(dataDir, 'secrets.json');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, JSON.stringify({ seal: crypto.randomBytes(32).toString('hex'), vault: crypto.randomBytes(32).toString('hex') }));
}
const secrets = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
process.env.SEAL_SECRET = secrets.seal;
process.env.VAULT_SECRET = secrets.vault;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'local';
// Le front exige une adresse Supabase pour s'ouvrir : en local, aucune connexion n'est possible
// (accès ouvert, shared/access.js), on lui donne une adresse qui ne sert qu'à passer ce contrôle.
process.env.VITE_SUPABASE_URL ||= `http://localhost:${PORT}/_sans-connexion`;
process.env.VITE_SUPABASE_ANON_KEY ||= 'local';

// `api/db-client.js` → base locale.
const localDb = pathToFileURL(path.join(here, 'db.mjs')).href;
registerHooks({
  resolve(specifier, context, next) {
    const out = next(specifier, context);
    return out.url.endsWith('/api/db-client.js') ? { ...out, url: localDb, shortCircuit: true } : out;
  },
});

const { default: db, LOCAL_STORAGE_DIR } = await import(localDb);
const { sealRows } = await import(pathToFileURL(path.join(root, 'api', '_seal.js')).href);

// Première ouverture : la base reçoit le catalogue d'exemple de l'application, scellé.
const { data: existing } = await db.from('products').select('id');
if (!existing || existing.length === 0) {
  const { seedTables } = await import(pathToFileURL(path.join(here, 'seed.mjs')).href);
  const tables = seedTables();
  for (const [table, rows] of Object.entries(tables)) {
    await db.from(table).upsert(rows);
    await sealRows(table, rows);
  }
  console.log(`[local] Base d'exemple créée : ${tables.products.length} produits, ${tables.categories.length} rayons.`);
}

const handlers = new Map();
async function handlerFor(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || name === 'db-client') return null;
  const file = path.join(root, 'api', `${name}.js`);
  if (!fs.existsSync(file)) return null;
  if (!handlers.has(name)) handlers.set(name, (await import(pathToFileURL(file).href)).default);
  return handlers.get(name);
}

/** Requête et réponse façon Vercel (`req.query`, `req.body`, `res.status().json()`). */
function vercelize(req, res, url, raw) {
  req.query = Object.fromEntries(url.searchParams);
  const type = String(req.headers['content-type'] || '');
  if (raw.length === 0) req.body = undefined;
  else if (type.includes('application/json')) {
    try {
      req.body = JSON.parse(raw.toString('utf8'));
    } catch {
      req.body = raw.toString('utf8');
    }
  } else if (type.startsWith('text/')) req.body = raw.toString('utf8');
  else req.body = raw;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (value) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(value));
    return res;
  };
  res.send = (value) => {
    if (typeof value === 'object' && !Buffer.isBuffer(value)) return res.json(value);
    res.end(value);
    return res;
  };
}

const readAll = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
const cleanPath = (p) => p.split('/').filter((s) => s && s !== '..' && s !== '.').map(decodeURIComponent).join('/');

const { createServer } = await import('vite');
const vite = await createServer({ root, server: { middlewareMode: true, hmr: { port: PORT + 1000 } }, appType: 'spa' });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        const handler = await handlerFor(url.pathname.slice(5).replace(/\/$/, ''));
        if (!handler) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Route inconnue' }));
        }
        const raw = await readAll(req);
        vercelize(req, res, url, raw);
        return await handler(req, res);
      }
      if (url.pathname.startsWith('/_storage/')) {
        const file = path.join(LOCAL_STORAGE_DIR, cleanPath(url.pathname.slice(10)));
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return fs.createReadStream(file).pipe(res);
      }
      if (url.pathname.startsWith('/_storage-upload/') && (req.method === 'PUT' || req.method === 'POST')) {
        const file = path.join(LOCAL_STORAGE_DIR, cleanPath(url.pathname.slice(17)));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await readAll(req));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.statusCode = 200;
        return res.end('{}');
      }
      if (url.pathname.startsWith('/_storage-upload/') && req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'PUT, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.statusCode = 204;
        return res.end();
      }
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    } catch (err) {
      console.error('[local] erreur', req.method, url.pathname, err);
      if (!res.headersSent) res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Erreur du serveur local' }));
    }
  })
  .listen(PORT, () => console.log(`[local] Tour de contrôle : http://localhost:${PORT} (base locale ${dataDir})`));
