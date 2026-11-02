// WCAG 2.x AA checks over the role colours, with a minimal fix: move one colour's lightness only as far as it needs.
import { bestOn, contrast, ensureContrast } from './color.ts';
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

export interface PairResult {
  mode: Mode;
  fg: RoleName;
  bg: RoleName;
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
    for (const bg of bgs) {
      const ratio = Math.round(contrast(colors[fg], colors[bg]) * 100) / 100;
      out.push({ mode, fg, bg, ratio, min, ok: contrast(colors[fg], colors[bg]) >= min });
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
    const r = ensureContrast(colors[fg], bgs.map((b) => colors[b]), min);
    if (!r.ok) continue;
    change(fg, r.hex, `${fg} needs ${min}:1 on ${bgs.join(', ')}`);
  }
  // primary moved? its text must still read.
  if (contrast(colors['on-primary'], colors.primary) < 4.5) change('on-primary', bestOn(colors.primary), 'on-primary needs 4.5:1 on primary');
  return adjustments;
}

export function report(light: ColorMap, dark: ColorMap | null): ContrastReport {
  const pairs = [...measure(light, 'light'), ...(dark ? measure(dark, 'dark') : [])];
  return { checked: pairs.length, fails: pairs.filter((p) => !p.ok), pairs };
}
