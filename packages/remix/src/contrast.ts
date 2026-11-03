// WCAG 2.x AA checks over the role colours, with a minimal fix: move one colour's lightness only as far as it needs.
import { bestOn, contrast, ensureContrast, mix, over } from './color.ts';
import type { ColorMap, Mode, Provenance, RoleName } from './model.ts';

/** [foreground, backgrounds, minimum ratio, fixable]. Text 4.5:1; borders, ring and the primary fill 3:1. */
const PAIRS: [RoleName, RoleName[], number][] = [
  ['text', ['background', 'surface', 'raised', 'secondary'], 4.5],
  ['muted-text', ['background', 'surface', 'raised'], 4.5],
  ['accent', ['background', 'surface'], 4.5],
  ['destructive', ['background', 'surface'], 4.5],
  ['success', ['background', 'surface'], 4.5],
  ['warning', ['background', 'surface'], 4.5],
  ['primary', ['background'], 3],
  ['border-strong', ['background', 'surface'], 3],
  ['ring', ['background'], 3],
];

/**
 * The fills equipe's component layer (emit --dtcg-legacy) derives from the roles, which text is drawn on too:
 * a status colour's own tint under a badge's text (`badge.ok-fg` on `badge.ok-bg`), the accent's under a
 * selected chip's, and the sunken well under a neutral badge's muted text.
 */
export const TINT_ALPHA = { status: 0.14, selected: 0.12 } as const;
/** The lightest a tint goes to keep its colour's text readable, before the colour itself has to move. */
export const TINT_FLOOR = 0.06;
export const SUNKEN_MIX: Record<Mode, number> = { light: 0.06, dark: 0.03 };
export const sunkenOf = (c: ColorMap, mode: Mode): string => mix(c.background, c.text, SUNKEN_MIX[mode]);
/** Roles whose text sits on their own tint. */
export const TINTED = ['accent', 'destructive', 'success', 'warning'] as const satisfies readonly RoleName[];
// The alpha as an 8-digit hex writes it, so the check measures what ships.
const q = (a: number) => Math.round(a * 255) / 255;
// Over the page, as equipe's check lays it (the colour itself is held to the surface by its own pair).
const tintOn = (c: ColorMap, role: RoleName, alpha: number) => [{ name: `${role} tint on background`, hex: over(c[role], q(alpha), c.background) }];

/**
 * How dense `role`'s tint is: 14% (12% at most for a selected chip, `cap`), lightened a point at a time
 * until the colour's own text reads 4.5:1 on it over the page — the colour stays as chosen.
 * At TINT_FLOOR it stops; the contrast fix then moves the colour.
 */
export function tintAlpha(c: ColorMap, role: RoleName, cap: number = TINT_ALPHA.status): number {
  for (let a = Math.round(cap * 100); a >= TINT_FLOOR * 100; a--) {
    if (tintOn(c, role, a / 100).every((b) => contrast(c[role], b.hex) >= 4.5)) return a / 100;
  }
  return TINT_FLOOR;
}

/** Everything `fg` must read on: the role backgrounds of its pair, then the derived fills it sits on. */
function backdrops(c: ColorMap, mode: Mode, fg: RoleName, bgs: RoleName[]): { name: string; hex: string }[] {
  const out = bgs.map((b) => ({ name: b as string, hex: c[b] }));
  if ((TINTED as readonly RoleName[]).includes(fg)) out.push(...tintOn(c, fg, tintAlpha(c, fg)));
  if (fg === 'muted-text') out.push({ name: 'sunken', hex: sunkenOf(c, mode) });
  return out;
}

export interface PairResult {
  mode: Mode;
  fg: RoleName;
  /** A role, or a fill derived from roles (`success tint on background`, `sunken`). */
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
}
export interface Adjustment {
  mode: Mode;
  role: RoleName;
  from: string;
  to: string;
  reason: string;
}
export interface ContrastReport {
  checked: number;
  fails: PairResult[];
  pairs: PairResult[];
}

export function measure(colors: ColorMap, mode: Mode): PairResult[] {
  const out: PairResult[] = [];
  for (const [fg, bgs, min] of PAIRS) {
    for (const bg of backdrops(colors, mode, fg, bgs)) {
      const r = contrast(colors[fg], bg.hex);
      out.push({ mode, fg, bg: bg.name, ratio: Math.round(r * 100) / 100, min, ok: r >= min });
    }
  }
  const onP = contrast(colors['on-primary'], colors.primary);
  out.push({ mode, fg: 'on-primary', bg: 'primary', ratio: Math.round(onP * 100) / 100, min: 4.5, ok: onP >= 4.5 });
  return out;
}

/** Fixes failing pairs in place, one role at a time, and says what it changed. */
export function fixContrast(
  colors: ColorMap,
  provenance: Partial<Record<RoleName, Provenance>>,
  mode: Mode,
): Adjustment[] {
  const adjustments: Adjustment[] = [];
  const change = (role: RoleName, to: string, reason: string) => {
    const from = colors[role];
    if (to === from) return;
    colors[role] = to;
    adjustments.push({ mode, role, from, to, reason });
    provenance[role] = { kind: 'contrast-fix', from, note: reason };
  };
  if (contrast(colors['on-primary'], colors.primary) < 4.5) change('on-primary', bestOn(colors.primary), 'on-primary needs 4.5:1 on primary');
  for (const [fg, bgs, min] of PAIRS) {
    // A tint follows its colour, so moving the colour moves what it is measured on: go round until it holds.
    // (A tint first lightens to TINT_FLOOR; only past that does the colour itself move.)
    const was = colors[fg];
    let names: string[] = [];
    for (let pass = 0; pass < 8; pass++) {
      const under = backdrops(colors, mode, fg, bgs);
      const r = ensureContrast(colors[fg], under.map((b) => b.hex), min);
      if (!r.ok || r.hex === colors[fg]) break;
      colors[fg] = r.hex;
      names = under.map((b) => b.name);
    }
    const to = colors[fg];
    colors[fg] = was;
    change(fg, to, `${fg} needs ${min}:1 on ${names.join(', ')}`);
  }
  // primary moved? its text must still read.
  if (contrast(colors['on-primary'], colors.primary) < 4.5) change('on-primary', bestOn(colors.primary), 'on-primary needs 4.5:1 on primary');
  return adjustments;
}

export function report(light: ColorMap, dark: ColorMap | null): ContrastReport {
  const pairs = [...measure(light, 'light'), ...(dark ? measure(dark, 'dark') : [])];
  return { checked: pairs.length, fails: pairs.filter((p) => !p.ok), pairs };
}
