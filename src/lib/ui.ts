/** '#RRGGBB' → 'rgba(r,g,b,a)' — comme components/Glow.tsx. */
export function rgba(hex: string, alpha: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return `rgba(122,170,44,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.round(alpha * 1000) / 1000})`;
}

/** Halo radial doux : la « lumière » que chaque produit projette sur l'interface. */
export const glow = (color: string, opacity = 0.5) =>
  `radial-gradient(ellipse closest-side, ${rgba(color, opacity)} 0%, ${rgba(color, opacity * 0.42)} 45%, ${rgba(color, opacity * 0.12)} 75%, ${rgba(color, 0)} 100%)`;

/**
 * Taille d'une photo dans un rayon rond, à « poids visuel » constant quelle que soit la
 * silhouette (HomeScreen.tsx → photoSize). La hauteur est bornée pour rester dans le rond.
 */
export function roundSize(ratio: number, scale = 1) {
  const r = ratio > 0 ? ratio : 1;
  let w = Math.min(50, 38 * Math.sqrt(r));
  let h = w / r;
  if (h > 50) {
    h = 50;
    w = h * r;
  }
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** Plus grande taille tenant dans un cadre, sans déformer. */
export function fit(ratio: number, maxW: number, maxH: number) {
  const r = ratio > 0 ? ratio : 1;
  const w = Math.min(maxW, maxH * r);
  return { width: Math.round(w), height: Math.round(w / r) };
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
