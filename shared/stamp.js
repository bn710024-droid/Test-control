/**
 * Écritures concurrentes d'une commande (voir api/orders.js). Une commande est un seul bloc chiffré
 * « v1.iv.étiquette.données » : l'IV est tiré au hasard et l'étiquette GCM dépend du contenu, donc
 * « v1.iv.étiquette » identifie une écriture précise. On s'en sert pour ne remplacer une commande que
 * si elle n'a pas changé depuis sa lecture.
 */

/** Empreinte d'un bloc chiffré : ses trois premiers morceaux (« v1.iv.étiquette »). */
export function stampOf(enc) {
  return String(enc ?? '').split('.').slice(0, 3).join('.');
}

/** Écriture canonique (clés triées) : deux objets égaux donnent le même texte. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Même commande, position du client mise à part (elle change seule, sans l'équipe). */
export function sameButLocation(a, b) {
  const { location: _a, ...restA } = a ?? {};
  const { location: _b, ...restB } = b ?? {};
  return canon(restA) === canon(restB);
}
