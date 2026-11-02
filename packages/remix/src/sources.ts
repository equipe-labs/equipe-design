// Turns an extract.json or a library tokens.json (DTCG, T-291 format) into a Source.
import { validateExtraction, type Extraction, type Length } from '@equipe-design/schema';
import { mix, normalizeHex, toHex, parseHex } from './color.ts';
import { completeMode, isChromatic } from './complete.ts';
import {
  ROLES, TYPE_ROLES,
  type ColorMap, type Model, type RoleName, type ShadowLayer, type Source, type TypeRoleName, type TypeStyle,
} from './model.ts';

const DEFAULT_TYPE: Record<TypeRoleName, TypeStyle> = {
  display: { family: 'sans', size: 56, weight: 700, lineHeight: 1.1, letterSpacing: -0.02 },
  h1: { family: 'sans', size: 40, weight: 700, lineHeight: 1.15, letterSpacing: -0.015 },
  h2: { family: 'sans', size: 32, weight: 600, lineHeight: 1.2, letterSpacing: -0.01 },
  h3: { family: 'sans', size: 24, weight: 600, lineHeight: 1.3, letterSpacing: 0 },
  body: { family: 'sans', size: 16, weight: 400, lineHeight: 1.6, letterSpacing: 0 },
  small: { family: 'sans', size: 14, weight: 400, lineHeight: 1.5, letterSpacing: 0 },
  mono: { family: 'mono', size: 14, weight: 400, lineHeight: 1.5, letterSpacing: 0 },
};
const DEFAULT_SPACE = [4, 8, 12, 16, 24, 32, 48, 64];
const DEFAULT_RADIUS = [4, 8, 12, 16];
const DEFAULT_MONO = ['JetBrains Mono', 'ui-monospace', 'monospace'];

const px = (l: Length | number): number => {
  if (typeof l === 'number') return l;
  return l.unit === 'rem' ? l.value * 16 : l.value;
};

export function hostLabels(urls: string[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    let host = u;
    try {
      host = new URL(u).hostname;
    } catch {
      /* keep as given */
    }
    host = host.replace(/^www\./, '').toLowerCase();
    out.add(host);
    const parts = host.split('.');
    if (parts.length > 1) out.add(parts.slice(0, -1).join('.'));
    if (parts.length > 2) out.add(parts[parts.length - 2]!);
    else if (parts[0]) out.add(parts[0]);
  }
  return [...out].filter((s) => s.length >= 3);
}

function fromExtraction(x: Extraction): Source {
  const colorById = new Map(x.observed.color.map((c) => [c.id, c.value.hex]));
  const alphaById = new Map(x.observed.color.map((c) => [c.id, c.value.alpha]));
  const limits: string[] = [];
  const given = { light: {} as Partial<Record<RoleName, { hex: string; ref: string }>>, dark: {} as Partial<Record<RoleName, { hex: string; ref: string }>> };
  for (const r of x.inferred.roles ?? []) {
    for (const mode of ['light', 'dark'] as const) {
      const id = r[mode];
      const hex = id ? colorById.get(id) : undefined;
      if (id && hex) given[mode][r.role] = { hex, ref: id };
    }
  }
  // A translucent colour (a 10% black border) is laid over the background so it becomes an opaque role colour.
  for (const mode of ['light', 'dark'] as const) {
    const bg = given[mode].background?.hex;
    for (const r of x.inferred.roles ?? []) {
      const g = given[mode][r.role];
      const a = g ? (alphaById.get(g.ref) ?? 1) : 1;
      if (g && bg && a < 1) g.hex = mix(bg, g.hex, a);
    }
  }
  const light = completeMode(given.light, 'light');
  if (!light) throw new Error('this extraction has no background and text role in light mode, so there is nothing to remix');
  const dark = completeMode(given.dark, 'dark');
  if (!dark) limits.push('dark: the source gave no dark background and text, so no dark theme is made');

  const brand = x.inferred.brand;
  const brandId = brand && brand.status !== 'none' ? (brand.color ?? brand.candidates[0]?.color ?? null) : null;
  const brandLight = brandId ? (colorById.get(brandId) ?? null) : null;
  let brandDark: string | null = null;
  if (brandId) {
    for (const r of x.inferred.roles ?? []) {
      if (r.light === brandId && r.dark && colorById.get(r.dark)) brandDark = colorById.get(r.dark)!;
    }
  }
  if (!brandLight) limits.push('brand: the source has no brand colour');

  const fams = x.observed.typography.families;
  const sansFam = fams.filter((f) => f.generic !== 'monospace').sort((a, b) => b.count - a.count)[0];
  const monoFam = fams.filter((f) => f.generic === 'monospace').sort((a, b) => b.count - a.count)[0];
  const stack = (f: typeof sansFam, fallback: string[]) => (f ? [f.name, ...fallback] : fallback);
  const model: Model = {
    colors: { light: light.colors, dark: dark?.colors ?? null },
    provenance: { light: light.provenance, dark: dark?.provenance ?? {} },
    fonts: {
      sans: stack(sansFam, ['system-ui', 'sans-serif']),
      mono: stack(monoFam, ['ui-monospace', 'monospace']),
      display: null,
    },
    type: {},
    space: [],
    radius: [],
    shadows: [],
    motion: { durations: [120, 200, 320], easing: [0.2, 0, 0, 1] },
    zIndex: [],
  };
  const styles = new Map(x.observed.typography.styles.map((s) => [s.id, s]));
  for (const tr of x.inferred.typeRoles ?? []) {
    const s = tr.style ? styles.get(tr.style) : undefined;
    if (!s) continue;
    const size = px(s.size);
    const lh = typeof s.lineHeight === 'number' ? s.lineHeight : px(s.lineHeight) / size;
    const ls = s.letterSpacing.unit === 'em' ? s.letterSpacing.value : s.letterSpacing.unit === '%' ? s.letterSpacing.value / 100 : px(s.letterSpacing) / size;
    model.type[tr.role] = { family: monoFam && s.family === monoFam.name ? 'mono' : 'sans', size, weight: s.weight, lineHeight: round(lh), letterSpacing: round(ls) };
  }
  for (const r of TYPE_ROLES) {
    if (!model.type[r]) {
      model.type[r] = { ...DEFAULT_TYPE[r], family: r === 'mono' ? 'mono' : 'sans' };
      limits.push(`type.${r}: not observed, a default style is used`);
    }
  }
  const sp = x.inferred.scales?.spacing?.steps?.length ? x.inferred.scales.spacing.steps : x.observed.spacing.map((s) => px(s.value));
  model.space = uniqSorted(sp).slice(0, 10);
  if (!model.space.length) { model.space = DEFAULT_SPACE; limits.push('space: not observed, default steps'); }
  const rd = x.inferred.scales?.radius?.steps?.length ? x.inferred.scales.radius.steps : x.observed.radius.filter((r) => r.kind !== 'full').map((r) => px(r.value));
  model.radius = uniqSorted(rd).filter((v) => v < 200).slice(0, 8);
  if (!model.radius.length) { model.radius = DEFAULT_RADIUS; limits.push('radius: not observed, default steps'); }
  model.shadows = [...x.observed.shadow].sort((a, b) => b.count - a.count).slice(0, 3).map((s) =>
    s.value.map((l) => ({ offsetX: l.offsetX, offsetY: l.offsetY, blur: l.blur, spread: l.spread, color: normalizeHex(l.color.hex), alpha: l.color.alpha, inset: l.inset })),
  );
  const dur = uniqSorted(x.observed.motion.map((m) => m.duration.value).filter((d) => d > 0 && d < 2000));
  if (dur.length) {
    const pick = (i: number) => dur[Math.min(dur.length - 1, i)]!;
    model.motion.durations = [pick(0), pick(Math.floor(dur.length / 2)), pick(dur.length - 1)];
  }
  const bez = [...x.observed.motion].sort((a, b) => b.count - a.count).find((m) => Array.isArray(m.easing) && m.easing.length === 4);
  if (bez) model.motion.easing = bez.easing as [number, number, number, number];
  model.zIndex = uniqSorted(x.observed.elevation.map((e) => e.zIndex).filter((z) => z > 0)).slice(0, 6);

  const urls = x.source.pages.flatMap((p) => [p.url, p.finalUrl ?? '']).filter(Boolean);
  return {
    kind: 'extraction',
    label: x.source.pages[0] ? hostLabels([x.source.pages[0].url])[0] ?? 'extraction' : 'extraction',
    forbiddenLabels: hostLabels(urls),
    model,
    brand: { light: brandLight, dark: brandDark },
    limits,
    fonts: fams.map((f) => ({ name: f.name, role: f.generic === 'monospace' ? 'mono' : 'sans', oflAlternatives: f.oflAlternatives, license: f.license })),
  };
}

interface DtcgLeaf { $value: unknown }
const leaf = (n: unknown): n is DtcgLeaf => !!n && typeof n === 'object' && '$value' in (n as object);
const num = (v: unknown): number => parseFloat(String(v));

function fromLibrary(t: Record<string, unknown>): Source {
  const get = (path: string): unknown => path.split('.').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), t);
  const val = (path: string): unknown => { const n = get(path); return leaf(n) ? n.$value : undefined; };
  const ext = (t.$extensions as Record<string, { name?: string; fontLicense?: string }> | undefined)?.['equipe.library'];
  const limits: string[] = [];
  const colorsOf = (mode: 'light' | 'dark') => {
    const out: Partial<Record<RoleName, { hex: string; ref: string }>> = {};
    for (const r of ROLES) {
      const v = val(`color.${mode}.${r}`);
      if (typeof v === 'string') out[r] = { hex: normalizeHex(v), ref: `color.${mode}.${r}` };
    }
    return out;
  };
  const light = completeMode(colorsOf('light'), 'light');
  if (!light) throw new Error('library tokens have no color.light.background / color.light.text');
  const dark = completeMode(colorsOf('dark'), 'dark');
  if (!dark) limits.push('dark: the system has no dark theme');
  const fam = (p: string): string[] | null => { const v = val(p); return Array.isArray(v) ? (v as string[]) : null; };
  const body = fam('typography.family.body') ?? ['system-ui', 'sans-serif'];
  const disp = fam('typography.family.display');
  const sameFam = disp && disp.join() === body.join();
  const size = (k: string) => num(val(`typography.size.${k}`));
  const wReg = num(val('typography.weight.regular')) || 400;
  const wHead = num(val('typography.weight.heading')) || 600;
  const lhBody = num(val('typography.lineHeight.body')) || 1.6;
  const lhHead = num(val('typography.lineHeight.heading')) || 1.25;
  const lsHead = num(val('typography.letterSpacing.heading')) || 0;
  const lsBody = num(val('typography.letterSpacing.body')) || 0;
  const heads = (sz: number, fam: 'sans' | 'display'): TypeStyle => ({ family: fam, size: sz, weight: wHead, lineHeight: lhHead, letterSpacing: lsHead });
  const hf = sameFam || !disp ? 'sans' : 'display';
  const type: Model['type'] = {
    display: heads(size('4xl'), hf), h1: heads(size('3xl'), hf), h2: heads(size('2xl'), hf), h3: heads(size('xl'), hf),
    body: { family: 'sans', size: size('md'), weight: wReg, lineHeight: lhBody, letterSpacing: lsBody },
    small: { family: 'sans', size: size('sm'), weight: wReg, lineHeight: lhBody, letterSpacing: lsBody },
    mono: { family: 'mono', size: size('sm'), weight: wReg, lineHeight: lhBody, letterSpacing: 0 },
  };
  limits.push('fonts.mono: the system has no monospace font, JetBrains Mono (OFL) is added');
  const space = Object.keys((get('spacing') as object) ?? {}).filter((k) => !k.startsWith('$')).map((k) => num(val(`spacing.${k}`)));
  const radius = Object.keys((get('radius') as object) ?? {}).filter((k) => !k.startsWith('$') && k !== 'full').map((k) => num(val(`radius.${k}`)));
  const shadowV = val('shadow.md');
  const shadows: ShadowLayer[][] = [];
  if (Array.isArray(shadowV)) {
    const layers = (shadowV as Record<string, string>[]).map((s) => {
      const c = parseHex(s.color ?? '#00000000');
      return { offsetX: num(s.offsetX), offsetY: num(s.offsetY), blur: num(s.blur), spread: num(s.spread), color: toHex(c.r, c.g, c.b), alpha: Math.round(c.a * 1000) / 1000, inset: false } satisfies ShadowLayer;
    }).filter((l) => l.alpha > 0 || l.blur > 0 || l.offsetY > 0);
    if (layers.length) shadows.push(layers);
  }
  const model: Model = {
    colors: { light: light.colors, dark: dark?.colors ?? null },
    provenance: { light: light.provenance, dark: dark?.provenance ?? {} },
    fonts: { sans: body, mono: DEFAULT_MONO, display: sameFam ? null : disp },
    type, space: uniqSorted(space), radius: uniqSorted(radius), shadows,
    motion: {
      durations: [num(val('motion.duration.fast')) || 0, num(val('motion.duration.base')) || 120, num(val('motion.duration.slow')) || 200],
      easing: ((val('motion.easing.standard') as number[] | undefined) ?? [0.2, 0, 0, 1]) as [number, number, number, number],
    },
    zIndex: [],
  };
  const accent = model.colors.light.accent;
  const brandKey: RoleName = isChromatic(accent) ? 'accent' : 'primary';
  const bl = model.colors.light[brandKey];
  const bd = model.colors.dark?.[brandKey] ?? null;
  const license = ext?.fontLicense ?? null;
  return {
    kind: 'library',
    label: ext?.name ?? 'library',
    forbiddenLabels: [],
    model,
    brand: { light: isChromatic(bl) ? bl : null, dark: bd && isChromatic(bd) ? bd : null },
    limits,
    fonts: [
      { name: body[0]!, role: 'sans', oflAlternatives: [], license },
      ...(disp && !sameFam ? [{ name: disp[0]!, role: 'display' as const, oflAlternatives: [], license }] : []),
    ],
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const uniqSorted = (a: number[]) => [...new Set(a.map(round))].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);

/** `json` is the parsed file. Throws with a readable message when it is neither an extraction nor a library system. */
export function loadSource(json: unknown): Source {
  if (json && typeof json === 'object' && 'schemaVersion' in json) {
    const v = validateExtraction(json);
    if (!v.ok) throw new Error(`extract.json is not valid: ${v.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
    return fromExtraction(v.value);
  }
  if (json && typeof json === 'object' && 'color' in json) return fromLibrary(json as Record<string, unknown>);
  throw new Error('not an extract.json (schemaVersion) or a library tokens.json (color.light / color.dark)');
}

export type { ColorMap };
