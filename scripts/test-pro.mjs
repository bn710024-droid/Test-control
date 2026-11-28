// Fiche pro : groupes de pays, devises, offres vues d'un pays, contrôle de saisie.
//   node scripts/test-pro.mjs
import assert from 'node:assert/strict';
import { proGroupOf, proCurrencyOf, validatePro, proOffersFor, proToDoc, proPriceText, emptyPro } from '../shared/pro.js';

let n = 0;
const t = (name, fn) => {
  fn();
  n += 1;
  console.log('ok', name);
};

t('groupes : FR → Europe €, US → $, MA → Afrique F CFA, AE → reste du monde $', () => {
  assert.equal(proGroupOf('FR'), 'eu');
  assert.equal(proCurrencyOf('FR'), 'EUR');
  assert.equal(proCurrencyOf('US'), 'USD');
  assert.equal(proGroupOf('MA'), 'af');
  assert.equal(proCurrencyOf('MA'), 'XOF');
  assert.equal(proGroupOf('AE'), 'monde');
  assert.equal(proCurrencyOf('??'), 'USD');
});

const sheet = {
  ...emptyPro(),
  offers: [
    { mode: 'avion', min: 500, step: 500, max: 5000, groups: { eu: { offered: true, EXW: '1,35', FOB: 1.6 }, na: { offered: true, EXW: null, FOB: null }, af: { offered: false }, monde: { offered: false } } },
    { mode: 'bateau', min: 1, step: 1, groups: { eu: { offered: true, EXW: 0.9, FOB: 1.1 }, af: { offered: true, EXW: 600, FOB: 700 } }, exceptions: [{ countries: ['DE'], EXW: 0.95, FOB: 1.2 }] },
  ],
};

t('contrôle : prix décimal avec virgule accepté, groupes complétés', () => {
  const { errors, value } = validatePro(sheet);
  assert.deepEqual(errors, {});
  assert.equal(value.offers[0].groups.eu.EXW, 1.35);
  assert.equal(value.offers[0].groups.monde.offered, false);
});

t('offres vues de France (€), États-Unis ($, prix sur demande), Maroc (F CFA, bateau seul)', () => {
  const { value } = validatePro(sheet);
  const fr = proOffersFor(value, 'FR');
  assert.deepEqual(fr.map((o) => [o.mode, o.currency, o.EXW]), [['avion', 'EUR', 1.35], ['bateau', 'EUR', 0.9]]);
  const us = proOffersFor(value, 'US');
  assert.deepEqual(us.map((o) => [o.mode, o.currency, o.EXW]), [['avion', 'USD', null]]);
  const ma = proOffersFor(value, 'MA');
  assert.deepEqual(ma.map((o) => [o.mode, o.currency, o.EXW]), [['bateau', 'XOF', 600]]);
  assert.deepEqual(proOffersFor(value, 'DE').map((o) => [o.mode, o.EXW]), [['avion', 1.35], ['bateau', 0.95]]);
  assert.equal(proOffersFor(value, 'AE').length, 0);
});

t('avion et bateau : prix distincts, jamais partagés', () => {
  const { value } = validatePro(sheet);
  assert.notEqual(value.offers[0].groups.eu.EXW, value.offers[1].groups.eu.EXW);
});

t('pays de vente : « sauf » exclut, « pays » limite', () => {
  const { value } = validatePro({ ...sheet, countries: { mode: 'sauf', list: ['fr'] } });
  assert.equal(proOffersFor(value, 'FR').length, 0);
  const only = validatePro({ ...sheet, countries: { mode: 'pays', list: ['US'] } }).value;
  assert.equal(proOffersFor(only, 'FR').length, 0);
  assert.equal(proOffersFor(only, 'US').length, 1);
});

t('erreurs : F CFA décimal, exception mêlant deux devises, deux lignes du même mode', () => {
  const bad = validatePro({
    offers: [
      { mode: 'avion', groups: { af: { offered: true, EXW: 12.5 } }, exceptions: [{ countries: ['FR', 'US'], EXW: 1 }] },
      { mode: 'avion' },
    ],
  });
  assert.ok(bad.errors['pro.offers.0.groups.af.EXW']);
  assert.ok(bad.errors['pro.offers.0.exceptions.0.countries']);
  assert.ok(bad.errors['pro.offers.1.mode']);
});

t('publication : seuls les groupes proposés, avec leur devise', () => {
  const doc = proToDoc(validatePro(sheet).value);
  assert.deepEqual(Object.keys(doc.offers[0].groups), ['eu', 'na']);
  assert.equal(doc.offers[1].groups.af.currency, 'XOF');
  assert.equal(doc.offers[1].exceptions[0].currency, 'EUR');
});

t('textes de prix', () => {
  assert.equal(proPriceText(1.35, 'EUR'), '1,35 €');
  assert.equal(proPriceText(3, 'USD'), '3,00 $');
  assert.equal(proPriceText(1500, 'XOF'), '1 500 F CFA');
  assert.equal(proPriceText(null, 'EUR'), 'Prix sur demande');
});

console.log(`\n${n} vérifications réussies`);
