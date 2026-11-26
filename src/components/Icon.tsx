import type { CSSProperties } from 'react';

type Props = {
  /** Caractère à afficher (voir lib/glyphs.ts). Vide : rien n'est rendu. */
  src: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Sans libellé, le repère est décoratif et ignoré des lecteurs d'écran. */
  label?: string;
};

/** Repère typographique : un caractère, jamais une image. Aucun SVG dans l'application. */
export function Icon({ src, size = 20, className = '', style, label }: Props) {
  if (!src) return null;
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-grid shrink-0 place-items-center font-bold leading-none ${className}`}
      style={{ minWidth: size, height: size, fontSize: Math.round(size * (src.length > 1 ? 0.8 : 1.05)), ...style }}
    >
      {src}
    </span>
  );
}
