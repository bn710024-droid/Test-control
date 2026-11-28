// Photos remplacées ou retirées : quels fichiers de l'espace `catalogue` peuvent être supprimés.
import assert from 'node:assert/strict';
import { catalogueFileOf, unusedFiles } from '../shared/files.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

const BASE = 'https://abc.supabase.co/storage/v1/object/public/catalogue/';

test('photo de produit ou de rayon envoyée par la tour : chemin reconnu', () => {
  assert.equal(catalogueFileOf(`${BASE}products/brocoli-1732712345678.png`), 'products/brocoli-1732712345678.png');
  assert.equal(catalogueFileOf(`${BASE}categories/filtre-tout-1732712345678.webp?t=1`), 'categories/filtre-tout-1732712345678.webp');
});

test('autres fichiers jamais visés (emballages, publications, photos embarquées, chemins douteux)', () => {
  assert.equal(catalogueFileOf(`${BASE}packagings/mangue-1-abc123.webp`), null);
  assert.equal(catalogueFileOf('https://abc.supabase.co/storage/v1/object/public/publications/photos/x.webp'), null);
  assert.equal(catalogueFileOf('/produce/pomme.webp'), null);
  assert.equal(catalogueFileOf(`${BASE}products/../settings.png`), null);
  assert.equal(catalogueFileOf(null), null);
});

test('fichier encore cité ailleurs : gardé', () => {
  const url = `${BASE}products/pomme-1.png`;
  assert.deepEqual(unusedFiles([url], [JSON.stringify([{ id: 'pomme-2', photo_url: url }])]), []);
});

test('fichier cité nulle part : supprimé, une seule fois', () => {
  const url = `${BASE}categories/seches-1.png`;
  assert.deepEqual(unusedFiles([url, url, null], [JSON.stringify([{ id: 'seches', image_url: null }])]), ['categories/seches-1.png']);
});

console.log(`\n${passed}/${passed} tests réussis`);
