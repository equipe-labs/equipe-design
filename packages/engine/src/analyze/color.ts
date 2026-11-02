import type { Rgba } from '../capture/inpage.ts';

// sRGB ↔ OKLab/OKLCH (Björn Ottosson's matrices). Small enough to keep here instead of a
// dependency.

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function rgbToOklab([r, g, b]: Rgba | [number, number, number]): [number, number, number] {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function rgbToOklch(c: Rgba | [number, number, number]): [number, number, number] {
  const [L, a, b] = rgbToOklab(c);
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [round(L, 4), round(C, 4), C < 0.0001 ? 0 : round(H, 2)];
}

export const round = (v: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

export function toHex([r, g, b]: Rgba | [number, number, number]): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function parseHex(hex: string): Rgba | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1]!;
  if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), s.length === 8 ? round(n(6) / 255, 3) : 1];
}

/** ΔE in OKLab (euclidean), 0..~1. */
export function deltaE(a: Rgba, b: Rgba): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export const chroma = (c: Rgba) => rgbToOklch(c)[1];
export const lightness = (c: Rgba) => rgbToOklch(c)[0];

/** WCAG relative luminance contrast, alpha ignored. */
export function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba) => 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composites a translucent colour over an opaque backdrop. */
export function over(c: Rgba, backdrop: Rgba): Rgba {
  const a = c[3];
  return [c[0] * a + backdrop[0] * (1 - a), c[1] * a + backdrop[1] * (1 - a), c[2] * a + backdrop[2] * (1 - a), 1];
}

export const colorKey = (c: Rgba) => `${toHex(c)}/${round(c[3], 2)}`;

/** Hue family used for status roles. */
export function hueFamily(c: Rgba): 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'pink' | 'neutral' {
  const [, C, H] = rgbToOklch(c);
  if (C < 0.04) return 'neutral';
  if (H < 15 || H >= 350) return 'pink';
  if (H < 45) return 'red';
  if (H < 70) return 'orange';
  if (H < 110) return 'yellow';
  if (H < 165) return 'green';
  if (H < 215) return 'teal';
  if (H < 285) return 'blue';
  if (H < 320) return 'violet';
  return 'pink';
}
