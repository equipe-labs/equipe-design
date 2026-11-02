// Fills the roles a source did not give, from the ones it did. Every filled role says so in `provenance`.
import { bestOn, contrast, mix, normalizeHex, toOklch } from './color.ts';
import { ROLES, type ColorMap, type Mode, type Provenance, type RoleName } from './model.ts';

const DEFAULT_STATUS: Record<Mode, Record<'destructive' | 'success' | 'warning', string>> = {
  light: { destructive: '#c62828', success: '#1b7a43', warning: '#8f5b00' },
  dark: { destructive: '#ff8a80', success: '#5fd68f', warning: '#f0b44c' },
};

export interface Completed {
  colors: ColorMap;
  provenance: Partial<Record<RoleName, Provenance>>;
}

/** Needs `background` and `text`; returns null otherwise (nothing is invented for a mode without them). */
export function completeMode(
  given: Partial<Record<RoleName, { hex: string; ref?: string }>>,
  mode: Mode,
): Completed | null {
  const bg = given.background?.hex;
  const fg = given.text?.hex;
  if (!bg || !fg) return null;
  const colors: Partial<ColorMap> = {};
  const provenance: Partial<Record<RoleName, Provenance>> = {};
  for (const r of ROLES) {
    const g = given[r];
    if (g) {
      colors[r] = normalizeHex(g.hex);
      provenance[r] = { kind: 'observed', ...(g.ref ? { ref: g.ref } : {}) };
    }
  }
  const set = (r: RoleName, hex: string, note: string) => {
    if (colors[r]) return;
    colors[r] = hex;
    provenance[r] = { kind: 'derived', note };
  };
  const B = colors.background!;
  const T = colors.text!;
  const dark = mode === 'dark';
  set('surface', mix(B, T, dark ? 0.06 : 0.04), 'background mixed 4-6% toward text');
  set('raised', mix(B, T, dark ? 0.1 : 0.02), 'background mixed 2-10% toward text');
  set('muted-text', mix(T, B, 0.4), 'text mixed 40% toward background');
  set('secondary', mix(B, T, 0.07), 'background mixed 7% toward text');
  set('border', mix(B, T, 0.14), 'background mixed 14% toward text');
  set('border-strong', mix(B, T, 0.55), 'background mixed 55% toward text');
  set('primary', colors.accent ?? T, colors.accent ? 'accent used as primary' : 'text colour used as primary');
  set('accent', colors.primary!, 'primary used as accent');
  set('on-primary', bestOn(colors.primary!), 'white or black, whichever reads better on primary');
  set('ring', colors.accent!, 'accent used as focus ring');
  for (const s of ['destructive', 'success', 'warning'] as const) {
    if (!colors[s]) {
      colors[s] = DEFAULT_STATUS[mode][s];
      provenance[s] = { kind: 'default', note: 'neutral status colour; the source gave none' };
    }
  }
  return { colors: colors as ColorMap, provenance };
}

export const isChromatic = (hex: string, min = 0.04) => toOklch(hex).c >= min;
export const ratio = contrast;
