import { bestOn, fromOklch, normalizeHex, toOklch } from './color.ts';
import { fixContrast, report, type Adjustment, type ContrastReport } from './contrast.ts';
import { isChromatic } from './complete.ts';
import { oflReplacement, type FontSwap } from './fonts.ts';
import type { ColorMap, Mode, Model, Provenance, RoleName, Source } from './model.ts';

export class RemixError extends Error {}

const STEP_L: Record<number, number> = { 50: 0.975, 100: 0.95, 200: 0.9, 300: 0.83, 400: 0.74, 500: 0.64, 600: 0.55, 700: 0.47, 800: 0.39, 900: 0.31, 950: 0.22 };
const NEUTRAL_ROLES: RoleName[] = ['background', 'surface', 'raised', 'secondary', 'border', 'border-strong', 'muted-text', 'text'];
const BRAND_ROLES: RoleName[] = ['primary', 'accent', 'ring'];

export type Strategy = 'accent' | 'tinted' | 'filled';
const STRATEGIES: { id: string; strategy: Strategy; label: string }[] = [
  { id: 'a', strategy: 'accent', label: 'Brand as accent — neutrals stay as they are' },
  { id: 'b', strategy: 'tinted', label: 'Brand as accent — neutrals tinted toward the brand hue' },
  { id: 'c', strategy: 'filled', label: 'Brand as the main fill — primary buttons carry it' },
];

export interface RemixOptions {
  /** 1 to 3 (default 3). */
  variants?: number;
  /** Swap fonts that are not open-licensed for an OFL family. */
  fontAlt?: boolean;
  /** Keep the source's own brand colour. Only allowed with ownSite. */
  keepBrand?: boolean;
  /** The caller says the sources are their own site. */
  ownSite?: boolean;
}

export interface RemixMeta {
  schema: 'equipe-design.remix/0.1';
  name: string;
  strategy: Strategy;
  brand: {
    requested: string | null;
    applied: string | null;
    original: { light: string | null; dark: string | null };
    kept: boolean;
    ownSite: boolean;
    /** Ramp steps generated from the requested colour (same lightness steps as the original). */
    ramp: Record<string, string>;
    roles: Partial<Record<Mode, RoleName[]>>;
  };
  /** Which source supplied colours / type / shape (index into `sources`). */
  mix: { colors: number; type: number; shape: number };
  /** Internal record of what was remixed. Never used in token or file names. */
  sources: { kind: Source['kind']; label: string }[];
  fonts: FontSwap[];
  adjustments: Adjustment[];
  limits: string[];
}

export interface Remix {
  id: string;
  label: string;
  model: Model;
  contrast: ContrastReport;
  meta: RemixMeta;
  /** Labels that emit must not find in a token name or a file name. */
  forbiddenLabels: string[];
}

export function brandRamp(hex: string): Record<number, string> {
  const u = toOklch(hex);
  const steps = Object.keys(STEP_L).map(Number);
  const anchor = steps.reduce((best, s) => (Math.abs(STEP_L[s]! - u.l) < Math.abs(STEP_L[best]! - u.l) ? s : best), steps[0]!);
  const out: Record<number, string> = {};
  for (const s of steps) {
    const l = STEP_L[s]!;
    const k = Math.min(1, Math.max(0.12, 1 - 1.6 * Math.abs(l - u.l)));
    out[s] = s === anchor ? normalizeHex(hex) : fromOklch({ l, c: u.c * k, h: u.h });
  }
  return out;
}

const nearestStep = (l: number) =>
  Object.keys(STEP_L).map(Number).reduce((best, s) => (Math.abs(STEP_L[s]! - l) < Math.abs(STEP_L[best]! - l) ? s : best), 500);

function pickMix(i: number, n: number) {
  return { colors: i % n, type: (i + 1) % n, shape: (i + 2) % n };
}

export function remix(sources: Source[], brand: { color?: string; name: string }, opts: RemixOptions = {}): Remix[] {
  if (!sources.length) throw new RemixError('give at least one source');
  if (sources.length > 3) throw new RemixError('mix at most 3 sources');
  if (opts.keepBrand && !opts.ownSite) {
    throw new RemixError('--keep-brand keeps the original brand colour, which is only allowed for your own site: add --own-site');
  }
  const count = Math.min(3, Math.max(1, opts.variants ?? 3));
  const out: Remix[] = [];
  for (let i = 0; i < count; i++) {
    const { id, strategy, label } = STRATEGIES[i]!;
    const mix = pickMix(i, sources.length);
    const colorSrc = sources[mix.colors]!;
    const typeSrc = sources[mix.type]!;
    const shapeSrc = sources[mix.shape]!;
    const keep = !!opts.keepBrand;
    const originals = { light: colorSrc.brand.light, dark: colorSrc.brand.dark ?? colorSrc.brand.light };
    let requested: string | null = null;
    if (!keep) {
      if (!brand.color) throw new RemixError('give your brand colour with --brand "#rrggbb"');
      try {
        requested = normalizeHex(brand.color);
      } catch {
        throw new RemixError(`--brand must be a hex colour like #0f766e, got "${brand.color}"`);
      }
    }
    const applied = keep ? originals.light : requested;
    if (!applied) throw new RemixError('the source has no brand colour to keep; give --brand instead');
    const ramp = brandRamp(applied);
    const hue = toOklch(applied).h;

    const colors: { light: ColorMap; dark: ColorMap | null } = {
      light: { ...colorSrc.model.colors.light },
      dark: colorSrc.model.colors.dark ? { ...colorSrc.model.colors.dark } : null,
    };
    const prov: Model['provenance'] = { light: { ...colorSrc.model.provenance.light }, dark: { ...colorSrc.model.provenance.dark } };
    const adjustments: Adjustment[] = [];
    const brandRoles: RemixMeta['brand']['roles'] = {};
    for (const mode of ['light', 'dark'] as Mode[]) {
      const c = colors[mode];
      if (!c) continue;
      const p = prov[mode];
      const set = (role: RoleName, hex: string, why: Provenance) => {
        c[role] = hex;
        p[role] = why;
      };
      let roles = BRAND_ROLES.filter((r) => isChromatic(c[r]));
      if (!roles.length) roles = ['accent', 'ring'];
      brandRoles[mode] = roles;
      if (!keep) {
        const exact = new Set<RoleName>(mode === 'light' ? roles.filter((r) => originals.light && c[r] === originals.light) : []);
        if (mode === 'light' && !exact.size) exact.add(roles.includes('accent') ? 'accent' : roles[0]!);
        for (const r of roles) {
          if (exact.has(r)) {
            set(r, applied, { kind: 'brand', note: 'your brand colour, as given', from: c[r] });
            continue;
          }
          const step = nearestStep(toOklch(c[r]).l);
          set(r, ramp[step]!, { kind: 'brand', note: `brand ramp step ${step}`, from: c[r] });
        }
      }
      if (strategy === 'tinted') {
        for (const r of NEUTRAL_ROLES) {
          if (isChromatic(c[r])) continue;
          const o = toOklch(c[r]);
          const chroma = Math.min(r === 'text' ? 0.012 : 0.02, Math.max(o.c, 0.008));
          set(r, fromOklch({ l: o.l, c: chroma, h: hue }), { kind: 'derived', note: 'neutral tinted toward the brand hue', from: c[r] });
        }
      }
      if (strategy === 'filled') {
        const step = mode === 'light' ? 700 : 300;
        set('primary', ramp[step]!, { kind: 'brand', note: `brand ramp step ${step} as primary fill`, from: c.primary });
        set('on-primary', bestOn(c.primary), { kind: 'derived', note: 'white or black on the brand fill' });
      }
      adjustments.push(...fixContrast(c, p, mode));
    }
    const fonts: FontSwap[] = [];
    const typeModel = typeSrc.model;
    const fontStacks = { sans: [...typeModel.fonts.sans], mono: [...typeModel.fonts.mono], display: typeModel.fonts.display ? [...typeModel.fonts.display] : null };
    if (opts.fontAlt) {
      for (const role of ['sans', 'mono', 'display'] as const) {
        const stack = fontStacks[role];
        if (!stack?.[0]) continue;
        const info = typeSrc.fonts.find((f) => f.name === stack[0]);
        const swap = oflReplacement(stack[0], info?.oflAlternatives ?? [], info?.license ?? null);
        if (swap) {
          stack[0] = swap.to;
          fonts.push(swap);
        }
      }
    }
    const model: Model = {
      colors,
      provenance: prov,
      fonts: fontStacks,
      type: typeModel.type,
      space: shapeSrc.model.space,
      radius: shapeSrc.model.radius,
      shadows: shapeSrc.model.shadows,
      motion: shapeSrc.model.motion,
      zIndex: shapeSrc.model.zIndex,
    };
    out.push({
      id,
      label,
      model,
      contrast: report(colors.light, colors.dark),
      meta: {
        schema: 'equipe-design.remix/0.1',
        name: brand.name,
        strategy,
        brand: { requested, applied, original: { light: originals.light, dark: originals.dark }, kept: keep, ownSite: !!opts.ownSite, ramp: Object.fromEntries(Object.entries(ramp).map(([k, v]) => [String(k), v])), roles: brandRoles },
        mix,
        sources: sources.map((s) => ({ kind: s.kind, label: s.label })),
        fonts,
        adjustments,
        limits: [...new Set([...colorSrc.limits, ...typeSrc.limits, ...shapeSrc.limits])],
      },
      forbiddenLabels: [...new Set(sources.flatMap((s) => s.forbiddenLabels))],
    });
  }
  return out;
}
