/** Mise en forme — mêmes conventions que lib/format.ts de l'application d'achat. */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');

export const euro = (n: number) => {
  const [whole, cents] = n.toFixed(2).split('.');
  return `${group(whole)},${cents}\u00A0€`;
};

/**
 * Montant dans la devise de la commande (comme l'application) : EUR → « 3,90 € », XOF / XAF →
 * « 2 500 F CFA », autre code ISO → « 12,00 USD ». Jamais de conversion.
 */
export const amount = (n: number, currency?: string | null) => {
  const code = (currency || 'EUR').toUpperCase();
  if (code === 'EUR') return euro(n);
  if (code === 'XOF' || code === 'XAF') return `${group(String(Math.round(n)))} F CFA`;
  const [whole, cents] = n.toFixed(2).split('.');
  return `${group(whole)},${cents} ${code}`;
};

export const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
export const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export const currentMonth = () => new Date().getMonth() + 1;

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const kgText = (kg: number) => `${group(String(Math.round(kg)))}\u00A0kg`;
export const count = (n: number) => group(String(n));
export const plural = (n: number, one: string, many: string) => `${count(n)}\u00A0${n > 1 ? many : one}`;

/**
 * Lit un nombre saisi à la française (« 3,50 », « 22 000 »). Champ vide : `null`.
 * Saisie illisible : `NaN`, que les contrôles signalent en clair.
 */
export function parseNum(raw: string): number | null {
  const s = String(raw ?? '')
    .replace(/[\s\u00A0\u202F€]/g, '')
    .replace(',', '.');
  if (s === '') return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

export const numStr = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '' : String(n).replace('.', ',');

export const isAllYear = (months: number[]) => months.length === 12;
export const isInSeason = (months: number[], m = currentMonth()) => months.includes(m);

export function nextSeasonStart(months: number[], m = currentMonth()) {
  for (let i = 1; i <= 12; i++) {
    const month = ((m - 1 + i) % 12) + 1;
    if (months.includes(month)) return month;
  }
  return m;
}

export function seasonText(months: number[]) {
  if (months.length === 0) return 'Saison à renseigner';
  if (isAllYear(months)) return 'Toute l’année';
  if (isInSeason(months)) return `De saison en ${MONTHS[currentMonth() - 1]}`;
  return `Hors saison · reprise en ${MONTHS[nextSeasonStart(months) - 1]}`;
}

/** « la barquette de 250 g » → « la barquette » */
export const unitTiny = (label: string) => label.split(' ').slice(0, 2).join(' ');

/** « à l’instant », « il y a 12 min », « hier à 14h05 », « le 3 novembre ». */
export function ago(iso: string) {
  const then = new Date(iso);
  const ms = Date.now() - then.getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min}\u00A0min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours}\u00A0h`;
  const hh = String(then.getHours()).padStart(2, '0');
  const mm = String(then.getMinutes()).padStart(2, '0');
  if (hours < 48) return `hier à ${hh}h${mm}`;
  return `le ${then.getDate() === 1 ? '1er' : then.getDate()} ${MONTHS[then.getMonth()]}`;
}

/** « 24 novembre à 14h05 » */
export function dateTime(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Montant pour un repère chiffré : sans centimes à partir de mille euros (« 15 400 € »). */
export const money = (n: number) => (Math.abs(n) >= 1000 ? `${group(String(Math.round(n)))}\u00A0€` : euro(n));

export function initials(email: string) {
  const name = email.split('@')[0] ?? '';
  const parts = name.split(/[.\-_+]/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
