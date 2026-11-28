/**
 * Photos fournies avec la tour : chaque clé de shared/assets.js a son fichier et sa vignette, et
 * chaque produit du catalogue d'exemple a sa photo.  node scripts/test-assets.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TOWER_ASSETS, embeddedAssetsOf } from '../shared/assets.js';

const files = fs.readdirSync('public/produce').filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)).sort();
assert.deepEqual([...TOWER_ASSETS].sort(), files, 'la liste doit correspondre aux fichiers de public/produce');
for (const a of TOWER_ASSETS) assert.ok(fs.existsSync(`public/produce/thumb/${a}.webp`), `vignette manquante : ${a}`);
const seed = JSON.parse(fs.readFileSync('scripts/local/seed-catalog.json', 'utf8'));
const missing = seed.doc.products.filter((p) => p.photo?.asset && !TOWER_ASSETS.includes(p.photo.asset)).map((p) => p.id);
assert.deepEqual(missing, [], 'produit sans photo dans la tour');
assert.ok(embeddedAssetsOf(null).includes('pomme'), 'base neuve (compat absent) : les photos restent connues');
assert.ok(embeddedAssetsOf({ embeddedAssets: ['autre'] }).includes('autre'));
console.log(`${TOWER_ASSETS.length} photos, ${TOWER_ASSETS.length} vignettes, 42 produits d'exemple couverts : 0 échec`);
