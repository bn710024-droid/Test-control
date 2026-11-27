/**
 * Remplissage de la base locale (scripts/local/server.mjs) à partir du catalogue d'exemple de
 * l'application (`seed-catalog.json`, extrait de app/lib/catalog/embedded.ts). Toutes les lignes
 * sont marquées « Exemple » (`is_example`) : ce sont des données de démonstration, jamais le
 * catalogue réel. Chaque ligne est scellée comme si l'administration l'avait écrite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Contenu d'un format de l'application (grammes) → contenu d'un emballage de la tour. */
function contentOf(grams) {
  if (!grams) return { qty: null, unit: 'piece' };
  if (grams >= 1000 && grams % 100 === 0) return { qty: grams / 1000, unit: 'kg' };
  return { qty: grams, unit: 'g' };
}

/** Visibilité de l'application → zone de la tour (« sn » pour le Sénégal seul). */
function zoneOf(v) {
  if (!v || v.mode === 'monde') return null;
  if (v.mode === 'monde_sauf') return { mode: 'except', except: v.countries };
  if (v.mode === 'pays' && v.countries.length === 1 && v.countries[0] === 'SN') return { mode: 'sn', except: [] };
  return null;
}

export function seedTables() {
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'seed-catalog.json'), 'utf8'));
  const { doc, filters, labels } = raw;
  const order = filters.map((f) => f.id).filter((id) => id in labels);
  const categories = order.map((id, i) => ({
    id,
    label: labels[id],
    illustration_product: doc.products.find((p) => p.category === id)?.id ?? null,
    image_url: null,
    image_ratio: 1,
    sort_order: i,
  }));
  const products = doc.products.map((p, i) => ({
    id: p.id,
    name: p.name,
    variety: p.variety,
    category: p.category,
    origin: p.origin,
    description: p.description,
    photo_asset: 'asset' in p.photo ? p.photo.asset : null,
    photo_url: 'url' in p.photo ? p.photo.url : null,
    photo_ratio: 1,
    tint: p.tint,
    months: p.months,
    available: p.available,
    archived: false,
    bio: p.bio,
    rating: p.rating,
    reviews: p.reviews,
    retail: p.retail,
    wholesale: p.wholesale,
    is_example: true,
    sort_order: i,
  }));
  const packagings = doc.products
    .filter((p) => p.formats.length > 0)
    .map((p) => ({
      id: p.id,
      items: p.formats.map((f) => {
        const countryRules = (f.settings ?? [])
          .filter((s) => s.mode === 'pays')
          .map((s) => ({ countries: s.countries, available: s.available !== false, price: s.price ?? null, photo_url: null }));
        return {
          id: f.id,
          label: f.label,
          ...contentOf(f.grams),
          price: f.price,
          step: f.step ?? 1,
          min: f.min ?? null,
          max: f.max ?? null,
          audience: 'tous',
          available: f.available !== false,
          photo_url: null,
          description: f.description ?? '',
          ...(countryRules.length ? { countryRules } : null),
        };
      }),
    }));
  const zones = doc.products.map((p) => ({ id: p.id, zone: zoneOf(p.visibility) })).filter((z) => z.zone);
  const settings = [{ key: 'rules', value: doc.rules }];
  return { categories, products, packagings, zones, settings };
}
