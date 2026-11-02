/**
 * Colour parsing and matching for the scorer. Two colours match when their OKLab distance
 * (ΔE_OK) is under 0.02 — alpha is ignored, so `#0a0a0c24` matches `#0a0a0c` (design README 5.2).
 */

export const DELTA_E_OK = 0.02;

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)`/`rgba(…)` → lowercase `#rrggbb` (alpha dropped), or null. */
export function toHex(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) return '#' + [...m[1]!.slice(0, 3)].map((c) => c + c).join('');
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s);
  if (m) return rgbHex(+m[1]!, +m[2]!, +m[3]!);
  return null;
}

export function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Figma's `{r,g,b}` in 0–1. */
export function figmaHex(c: { r: number; g: number; b: number }): string {
  return rgbHex(c.r * 255, c.g * 255, c.b * 255);
}

/** Every colour written anywhere in a text (hex and rgb()), as `#rrggbb`. */
export function scanColors(text: string): Set<string> {
  const out = new Set<string>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/#[0-9a-f]{3,8}\b/g)) {
    if (m[0].length === 4 || m[0].length === 7 || m[0].length === 9) out.add(toHex(m[0])!);
  }
  for (const m of t.matchAll(/rgba?\(\s*\d+(?:\.\d+)?[\s,]+\d+(?:\.\d+)?[\s,]+\d+(?:\.\d+)?/g)) {
    const h = toHex(m[0] + ')');
    if (h) out.add(h);
  }
  return out;
}

type Lab = [number, number, number];

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export function oklab(hex: string): Lab {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = lin(((n >> 16) & 255) / 255);
  const g = lin(((n >> 8) & 255) / 255);
  const b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function deltaE(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

export function sameColor(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = toHex(a);
  const y = toHex(b);
  if (!x || !y) return false;
  return x === y || deltaE(x, y) < DELTA_E_OK;
}

/** OKLCH chroma; under ~0.04 reads as a grey. */
export function chroma(hex: string): number {
  const [, a, b] = oklab(hex);
  return Math.hypot(a, b);
}

export function hasColor(set: Iterable<string>, hex: string): boolean {
  const h = toHex(hex);
  if (!h) return false;
  for (const c of set) if (c === h || deltaE(c, h) < DELTA_E_OK) return true;
  return false;
}
