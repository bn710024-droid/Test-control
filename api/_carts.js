import crypto from 'node:crypto';
import supabase from './db-client.js';
import { requireAdmin, log } from './_lib.js';
import { tooMany } from './_limit.js';
import { vaultSeal, vaultOpen } from './_seal.js';
import { loadAppDocument } from './_catalog-data.js';
import { stampOf } from '../shared/stamp.js';
import {
  validateCart,
  priceCart,
  cartStatus,
  cartExpired,
  cartContent,
  latestOrderAfter,
  CONTACT_WAYS,
  CONTACT_LABEL,
} from '../shared/carts.js';

/**
 * Paniers en cours (voir shared/carts.js) : un par compte, dans la table `carts`, chiffré comme
 * les commandes. Appelé par api/orders.js :
 *  POST `{ type: 'panier', … }`  : réception, sans connexion ; secret du compte vérifié ;
 *  GET  `?vue=paniers`           : la liste (équipe) — les paniers vides ou de plus de 30 jours
 *                                  sont supprimés au passage ;
 *  PUT  `{ cart: { id, contacted_via } }` : le client a été relancé (équipe) ;
 *  DELETE `{ cartId }`           : suppression (responsables).
 * `loadOrders` : les commandes déchiffrées (api/orders.js), pour lier un panier à sa commande.
 */
const TABLE = 'carts';

/** Empreinte du secret du compte : le secret lui-même n'est jamais rangé. */
const hashOf = (secret) => crypto.createHash('sha256').update(String(secret)).digest('hex');
const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function loadOne(accountId) {
  const { data: row, error } = await supabase.from(TABLE).select('*').eq('account_id', accountId).maybeSingle();
  if (error) throw error;
  const cart = row ? vaultOpen(row.account_id, row.enc) : null;
  return row && cart ? { row, cart } : row ? { row, cart: null } : null;
}

/** Écrit un panier : création, ou remplacement seulement si la ligne n'a pas changé depuis sa lecture. */
async function write(accountId, cart, readEnc) {
  const values = { enc: vaultSeal(accountId, cart), updated_at: cart.updated_at, status: cart.status === 'commande' ? 'commande' : 'actif' };
  if (!readEnc) {
    const { error } = await supabase.from(TABLE).insert({ account_id: accountId, ...values });
    if (error && error.code === '23505') return false; // créé entre-temps : on relit et on recommence
    if (error) throw error;
    return true;
  }
  const { data, error } = await supabase.from(TABLE).update(values).eq('account_id', accountId).like('enc', `${stampOf(readEnc)}.%`).select('account_id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

async function remove(accountId) {
  const { error } = await supabase.from(TABLE).delete().eq('account_id', accountId);
  if (error) throw error;
}

/** Commandes et demandes d'un compte, telles que le panier les relie. */
const ordersOf = (orders, accountId) =>
  orders.filter((o) => o.customer?.account_id === accountId).map((o) => ({ id: o.id, number: o.number, received_at: o.received_at }));

/** Réception d'un panier envoyé par l'application. */
export async function receiveCart(req, body, res, { loadOrders }) {
  if (await tooMany(req, res, 'panier', 30, 60)) return;
  const checked = validateCart(body);
  if (checked.error) return res.status(checked.status).json({ error: checked.error });
  const v = checked.value;
  const hash = hashOf(v.secret);
  const content = cartContent(v);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await loadOne(v.account_id);
    if (found && !found.cart) return res.status(409).json({ error: 'Panier illisible : il sera remplacé par l’équipe.' });
    const before = found?.cart ?? null;
    // Le premier envoi lie le panier au secret du compte ; les suivants doivent présenter le même.
    if (before?.secret_hash && !sameHash(before.secret_hash, hash)) return res.status(403).json({ error: 'Secret de compte invalide : envoi refusé.' });
    // Même état renvoyé (relecture, passage en arrière-plan) : rien ne change.
    if (before && before.content === content) return res.status(200).json({ ok: true, unchanged: true });
    const now = new Date().toISOString();

    if (v.lines.length === 0) {
      // Panier vidé : par une commande reçue depuis sa dernière modification → « commandé » ;
      // sinon il n'y a plus rien à suivre, il est supprimé.
      const placed = before?.lines?.length ? latestOrderAfter(ordersOf(await loadOrders(), v.account_id), before.changed_at) : null;
      if (!placed) {
        if (found) await remove(v.account_id);
        return res.status(200).json({ ok: true, status: 'vide' });
      }
      const next = { ...before, content, status: 'commande', order: placed, received_at: now };
      if (await write(v.account_id, next, found.row.enc)) return res.status(200).json({ ok: true, status: 'commande' });
      continue;
    }

    // Prix recalculés d'après le catalogue publié : jamais ceux envoyés par l'appareil.
    const pro = v.account.type === 'pro';
    const who = { country: v.country || v.account.country, zoneCountry: v.account.country || v.country, pro, modes: pro && (v.account.activity === 'grossiste' || v.account.activity === 'importateur'), incoterm: v.incoterm };
    const priced = priceCart(await loadAppDocument(), v.lines, who);
    // Un nouveau panier après une commande repart de zéro (relances comprises).
    const fresh = !before || before.status === 'commande';
    const next = {
      account: v.account,
      country: who.country,
      incoterm: pro ? v.incoterm : null,
      secret_hash: hash,
      content,
      lines: priced.lines,
      totals: priced.totals,
      unpriced: priced.unpriced,
      updated_at: v.updated_at,
      changed_at: now,
      received_at: now,
      created_at: fresh ? now : (before.created_at ?? now),
      status: 'actif',
      order: null,
      contacts: fresh ? [] : (before.contacts ?? []),
    };
    if (await write(v.account_id, next, found?.row.enc ?? null)) return res.status(200).json({ ok: true, status: 'actif', totals: priced.totals });
  }
  return res.status(409).json({ error: 'Panier modifié au même moment : il sera renvoyé.' });
}

/** Ce que la page « Paniers » reçoit d'un panier (sans le secret ni l'empreinte). */
function viewOf(row, cart, orders, now) {
  const { status, order } = cartStatus(cart, ordersOf(orders, row.account_id), now);
  return {
    id: row.account_id,
    account: cart.account,
    country: cart.country,
    incoterm: cart.incoterm ?? null,
    lines: cart.lines,
    totals: cart.totals,
    unpriced: cart.unpriced ?? 0,
    updated_at: cart.updated_at,
    changed_at: cart.changed_at,
    created_at: cart.created_at ?? cart.changed_at,
    status,
    order,
    contacts: cart.contacts ?? [],
  };
}

/** Liste des paniers (équipe). Les paniers vides ou trop anciens sont supprimés au passage. */
export async function listCarts(req, res, { loadOrders }) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  res.setHeader('Cache-Control', 'no-store');
  const [{ data: rows, error }, orders] = await Promise.all([supabase.from(TABLE).select('*').order('updated_at', { ascending: false }), loadOrders()]);
  if (error) throw error;
  const now = Date.now();
  const carts = [];
  for (const row of rows) {
    const cart = vaultOpen(row.account_id, row.enc);
    if (!cart) continue; // ligne illisible (écrite hors du serveur) : ignorée
    if (cartExpired({ ...cart, updated_at: row.updated_at }, now)) {
      await remove(row.account_id);
      continue;
    }
    carts.push(viewOf(row, cart, orders, now));
  }
  return res.status(200).json({ carts, scope: 'all' });
}

/** Le client a été relancé depuis la fiche du panier (WhatsApp, appel, e-mail). */
export async function updateCart(admin, input, res, { loadOrders }) {
  const id = String(input?.id ?? '');
  if (!CONTACT_WAYS.includes(input?.contacted_via)) return res.status(400).json({ error: 'Moyen de contact inconnu.' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await loadOne(id);
    if (!found?.cart) return res.status(404).json({ error: 'Panier introuvable : il a peut-être été vidé ou commandé.' });
    const at = new Date().toISOString();
    const next = { ...found.cart, contacts: [...(found.cart.contacts ?? []), { via: input.contacted_via, at }].slice(-20) };
    if (await write(id, next, found.row.enc)) {
      await log(admin, 'update', 'cart', id, `Panier de ${found.cart.account?.name || 'client sans nom'} : client relancé par ${CONTACT_LABEL[input.contacted_via]}`);
      return res.status(200).json(viewOf(found.row, next, await loadOrders(), Date.now()));
    }
  }
  return res.status(409).json({ error: 'Ce panier vient de changer : rechargez la page.' });
}

/** Suppression d'un panier (responsables). */
export async function removeCart(admin, cartId, res) {
  const found = await loadOne(String(cartId ?? ''));
  if (!found) return res.status(404).json({ error: 'Panier introuvable : il a peut-être déjà été supprimé.' });
  await remove(found.row.account_id);
  await log(admin, 'delete', 'cart', found.row.account_id, `Panier de ${found.cart?.account?.name || 'client sans nom'} supprimé`);
  return res.status(200).json({ ok: true });
}
