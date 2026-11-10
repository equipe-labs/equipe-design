// Colour maths: sRGB hex <-> OKLCH, WCAG contrast, gamut-safe construction.
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function parseHex(hex: string): { r: number; g: number; b: number; a: number } {
  let h = hex.trim().replace('#', '').toLowerCase();
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^([0-9a-f]{6}|[0-9a-f]{8})$/.test(h)) throw new Error(`not a hex colour: ${hex}`);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
}

export function normalizeHex(hex: string): string {
  const c = parseHex(hex);
  return toHex(c.r, c.g, c.b);
}

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLin = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

function linRgb(hex: string): [number, number, number] {
  const c = parseHex(hex);
  return [toLin(c.r / 255), toLin(c.g / 255), toLin(c.b / 255)];
}

export function toOklch(hex: string): Oklch {
  const [r, g, b] = linRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  return { l: L, c: c < 1e-4 ? 0 : c, h: c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function rawFromOklch({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH -> hex. Chroma is reduced (lightness and hue kept) until the colour fits in sRGB. */
export function fromOklch(o: Oklch): string {
  const l = clamp01(o.l);
  if (l <= 0) return '#000000';
  if (l >= 1) return '#ffffff';
  let lo = 0;
  let hi = Math.max(0, o.c);
  let rgb = rawFromOklch({ l, c: hi, h: o.h });
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(rawFromOklch({ l, c: mid, h: o.h }))) lo = mid;
      else hi = mid;
    }
    rgb = rawFromOklch({ l, c: lo, h: o.h });
  }
  const [r, g, b] = rgb.map((v) => fromLin(clamp01(v)) * 255) as [number, number, number];
  return toHex(r, g, b);
}

export function luminance(hex: string): number {
  const [r, g, b] = linRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Mix in OKLab: t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = toOklch(a);
  const y = toOklch(b);
  const ax = x.c * Math.cos((x.h * Math.PI) / 180);
  const ay = x.c * Math.sin((x.h * Math.PI) / 180);
  const bx = y.c * Math.cos((y.h * Math.PI) / 180);
  const by = y.c * Math.sin((y.h * Math.PI) / 180);
  const A = ax + (bx - ax) * t;
  const B = ay + (by - ay) * t;
  const c = Math.hypot(A, B);
  return fromOklch({ l: x.l + (y.l - x.l) * t, c, h: c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 });
}

/** Whichever of near-white / near-black reads better on the given colour. */
export function bestOn(bg: string): string {
  return contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000';
}

/**
 * Moves the lightness of `fg` away from the backgrounds (chroma and hue kept) until it reaches `min` on every one.
 * Returns the colour and whether the target is reached (false only when even black/white cannot).
 */
export function ensureContrast(fg: string, bgs: string[], min: number): { hex: string; ok: boolean } {
  const worst = (c: string) => Math.min(...bgs.map((b) => contrast(c, b)));
  if (worst(fg) >= min) return { hex: fg, ok: true };
  const o = toOklch(fg);
  const bgLight = bgs.reduce((s, b) => s + toOklch(b).l, 0) / bgs.length;
  const dir = bgLight >= 0.6 ? -1 : 1;
  for (let i = 1; i <= 200; i++) {
    const l = o.l + dir * 0.005 * i;
    if (l < 0 || l > 1) break;
    const hex = fromOklch({ ...o, l });
    if (worst(hex) >= min) return { hex, ok: true };
  }
  const end = dir < 0 ? '#000000' : '#ffffff';
  return { hex: end, ok: worst(end) >= min };
}

/** `fg` at `alpha` laid over the opaque `bg` in sRGB, as a browser draws a translucent fill (each channel rounded). */
export function over(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const ch = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha));
  return toHex(ch(f.r, b.r), ch(f.g, b.g), ch(f.b, b.b));
}
