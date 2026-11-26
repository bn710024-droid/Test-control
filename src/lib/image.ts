/**
 * Préparation d'une photo avant envoi, dans le navigateur :
 *  - lecture, puis rognage des marges transparentes (les photos de l'application sont cadrées
 *    au plus près du fruit : c'est ce qui leur donne le même « poids » à l'écran) ;
 *  - réduction à 900 px de côté au plus, sans déformation ;
 *  - contrôle de la transparence : une photo à fond plein n'est pas « détourée » ;
 *  - proposition d'une teinte d'ambiance d'après les couleurs du produit.
 */
export type Prepared = {
  blob: Blob;
  type: string;
  previewUrl: string;
  ratio: number;
  width: number;
  height: number;
  /** Vrai : l'image a un fond transparent (photo détourée). */
  cutout: boolean;
  trimmed: boolean;
  tint: string | null;
  bytes: number;
};

const MAX_SIDE = 900;
const ACCEPTED = ['image/png', 'image/webp', 'image/jpeg'];

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible. Essayez un autre fichier (PNG, WebP ou JPEG).'));
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export async function prepareImage(file: File): Promise<Prepared> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('Format non pris en charge. Choisissez une image PNG, WebP ou JPEG.');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('Fichier trop lourd (15 Mo au plus avant préparation).');
  }
  const img = await load(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('Image vide ou illisible.');

  // Analyse sur une copie réduite : rapide, même pour une photo de téléphone.
  const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Ce navigateur ne permet pas de préparer l’image.');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  let clear = 0;
  let r = 0, g = 0, b = 0, weight = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a < 16) {
        clear++;
        continue;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (a > 200 && (x + y) % 3 === 0) {
        const mx = Math.max(data[i], data[i + 1], data[i + 2]);
        const mn = Math.min(data[i], data[i + 1], data[i + 2]);
        // Les couleurs franches comptent davantage que les gris et les reflets.
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const k = sat * sat * (mx / 255) + 0.02;
        r += data[i] * k;
        g += data[i + 1] * k;
        b += data[i + 2] * k;
        weight += k;
      }
    }
  }
  if (maxX < 0) throw new Error('Cette image est entièrement transparente.');

  const cutout = clear / (w * h) > 0.04;
  const pad = 2;
  const box = cutout
    ? {
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        w: Math.min(w, maxX + pad + 1) - Math.max(0, minX - pad),
        h: Math.min(h, maxY + pad + 1) - Math.max(0, minY - pad),
      }
    : { x: 0, y: 0, w, h };
  const trimmed = cutout && (box.w < w - 4 || box.h < h - 4);

  const out = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
  const ow = Math.max(1, Math.round(box.w * out));
  const oh = Math.max(1, Math.round(box.h * out));
  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  const octx = canvas.getContext('2d');
  if (!octx) throw new Error('Ce navigateur ne permet pas de préparer l’image.');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(work, box.x, box.y, box.w, box.h, 0, 0, ow, oh);

  // WebP garde la transparence et pèse peu ; certains navigateurs ne savent pas l'écrire.
  let blob = await toBlob(canvas, 'image/webp', 0.88);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, cutout ? 'image/png' : 'image/jpeg', 0.9);
  if (!blob) throw new Error('La préparation de l’image a échoué.');
  if (blob.size > 3 * 1024 * 1024) {
    throw new Error('Image encore trop lourde après préparation. Choisissez une image plus simple.');
  }

  return {
    blob,
    type: blob.type,
    previewUrl: URL.createObjectURL(blob),
    ratio: Math.round((ow / oh) * 1000) / 1000,
    width: ow,
    height: oh,
    cutout,
    trimmed,
    tint: weight > 0 ? `#${hex(r / weight)}${hex(g / weight)}${hex(b / weight)}`.toUpperCase() : null,
    bytes: blob.size,
  };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(blob);
  });
}
