// Model -> DTCG files (README 1.5): primitive -> semantic (light/dark) -> component.
import { readFileSync } from 'node:fs';
import { loadSource, mix, toOklch, normalizeHex, parseHex, bestOn, sunkenOf, tintAlpha, ROLES, TINT_ALPHA, TYPE_ROLES, type Model, type Remix, type RoleName } from '@equipe-design/remix';
import type { Extraction } from '@equipe-design/schema';
import type { DtcgFiles, Json, JsonObject, Resolved, Rgba, ShadowV, Token, Typo } from './tokens.ts';

const EXT = 'im.equipe.design';
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export interface ToDtcgOptions {
  /** Strings like "4px" instead of 2025.10 objects, and equipe's own token layout, for design/scripts/build.mjs. */
  legacy?: boolean;
}

function hueGroup(hex: string): string {
  const o = toOklch(hex);
  if (o.c < 0.04) return 'neutral';
  const h = o.h;
  if (h >= 345 || h < 25) return 'red';
  if (h < 70) return 'orange';
  if (h < 110) return 'yellow';
  if (h < 165) return 'green';
  if (h < 205) return 'teal';
  if (h < 265) return 'blue';
  if (h < 320) return 'violet';
  return 'pink';
}

/** Puts each distinct colour in a neutral group (by hue) at a lightness step (0-1000, 25 apart). */
class Palette {
  private byHex = new Map<string, [string, number]>();
  private taken = new Map<string, string>();
  ref(hex: string): string {
    const h = normalizeHex(hex);
    let at = this.byHex.get(h);
    if (!at) {
      const group = hueGroup(h);
      let step = Math.min(975, Math.max(0, Math.round(((1 - toOklch(h).l) * 1000) / 25) * 25));
      while (this.taken.has(`${group}.${step}`) && this.taken.get(`${group}.${step}`) !== h) step += 25;
      at = [group, step];
      this.byHex.set(h, at);
      this.taken.set(`${group}.${step}`, h);
    }
    return `{color.raw.${at[0]}.${at[1]}}`;
  }
  tree(wrap: (hex: string) => Json): JsonObject {
    const raw: JsonObject = { $type: 'color' };
    const entries = [...this.byHex].sort((a, b) => a[1][1] - b[1][1]);
    for (const [hex, [group, step]] of entries) {
      const g = (raw[group] ??= {}) as JsonObject;
      g[String(step)] = { $value: wrap(hex) };
    }
    return raw;
  }
}

const colorObj = (hex: string, alpha = 1): Json => {
  const c = parseHex(hex);
  const o: JsonObject = { colorSpace: 'srgb', components: [round(c.r / 255), round(c.g / 255), round(c.b / 255)] };
  if (alpha < 1) o.alpha = round(alpha);
  o.hex = normalizeHex(hex);
  return o;
};
const colorLegacy = (hex: string, alpha = 1): Json => (alpha < 1 ? normalizeHex(hex) + Math.round(alpha * 255).toString(16).padStart(2, '0') : normalizeHex(hex));

const WEIGHT_NAMES: Record<number, string> = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'regular', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const RADIUS_NAMES = ['sm', 'md', 'lg', 'xl'];

export function radiusNames(steps: number[]): { name: string; px: number }[] {
  const n = steps.length;
  const idx = n <= 4 ? steps.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return idx.map((i, k) => ({ name: RADIUS_NAMES[k]!, px: steps[i]! }));
}

function toModel(input: Remix | Extraction | Model): Model {
  if ('model' in input) return input.model;
  if ('schemaVersion' in input) return loadSource(input).model;
  return input;
}

export function toDtcg(input: Remix | Extraction | Model, opts: ToDtcgOptions = {}): DtcgFiles {
  const model = toModel(input);
  const legacy = !!opts.legacy;
  const dimV = (px: number): Json => (legacy ? `${round(px, 3)}px` : { value: round(px, 3), unit: 'px' });
  const durV = (ms: number): Json => (legacy ? `${ms}ms` : { value: ms, unit: 'ms' });
  const colV = (hex: string, a = 1) => (legacy ? colorLegacy(hex, a) : colorObj(hex, a));
  const palette = new Palette();

  const semantic = (mode: 'light' | 'dark'): JsonObject | null => {
    const colors = model.colors[mode];
    if (!colors) return null;
    const color: JsonObject = { $type: 'color' };
    for (const r of ROLES) {
      const p = model.provenance[mode][r];
      const node: JsonObject = { $value: palette.ref(colors[r]) };
      if (p) node.$extensions = { [EXT]: { source: p.ref ?? p.kind, kind: p.kind, ...(p.note ? { note: p.note } : {}), ...(p.from ? { from: p.from } : {}) } };
      color[r] = node;
    }
    return { $description: `semantic colour, ${mode}. Same keys in light and dark; only the values differ.`, color };
  };
  const light = semantic('light')!;
  const dark = semantic('dark');

  const radius: JsonObject = { $type: 'dimension' };
  const rn = radiusNames(model.radius);
  for (const { name, px } of rn) radius[name] = { $value: dimV(px) };
  radius.full = { $value: dimV(9999) };
  const space: JsonObject = { $type: 'dimension' };
  model.space.forEach((px, i) => (space[String(i + 1)] = { $value: dimV(px) }));
  const family: JsonObject = { $type: 'fontFamily', sans: { $value: model.fonts.sans }, mono: { $value: model.fonts.mono } };
  if (model.fonts.display) family.display = { $value: model.fonts.display };
  const weights = [...new Set([400, ...Object.values(model.type).map((t) => t!.weight)])].sort((a, b) => a - b);
  const weight: JsonObject = { $type: 'fontWeight' };
  for (const w of weights) weight[WEIGHT_NAMES[w] ?? `w${w}`] = { $value: w };
  const shadow: JsonObject = { $type: 'shadow' };
  model.shadows.forEach((layers, i) => {
    const vals = layers.map((l) => ({ color: colV(l.color, l.alpha), offsetX: dimV(l.offsetX), offsetY: dimV(l.offsetY), blur: dimV(l.blur), spread: dimV(l.spread), ...(l.inset ? { inset: true } : {}) }));
    shadow[String(i + 1)] = { $value: vals as unknown as Json };
  });
  const duration: JsonObject = { $type: 'duration' };
  (['fast', 'base', 'slow'] as const).forEach((n, i) => (duration[n] = { $value: durV(model.motion.durations[i]!) }));
  const easing: JsonObject = { $type: 'cubicBezier', standard: { $value: model.motion.easing } };
  const z: JsonObject = { $type: 'number' };
  model.zIndex.forEach((v, i) => (z[String(i + 1)] = { $value: v }));

  const type: JsonObject = { $type: 'typography' };
  for (const role of TYPE_ROLES) {
    const t = model.type[role];
    if (!t) continue;
    const wn = WEIGHT_NAMES[t.weight] ?? `w${t.weight}`;
    const lh = legacy ? dimV(round(t.size * t.lineHeight, 2)) : t.lineHeight;
    const ls = legacy ? `${round(t.letterSpacing, 4)}em` : dimV(round(t.letterSpacing * t.size, 3));
    type[role] = { $value: { fontFamily: `{font.family.${t.family}}`, fontSize: dimV(t.size), fontWeight: `{font.weight.${wn}}`, lineHeight: lh, letterSpacing: ls } };
  }

  const primitive: JsonObject = {
    $description: 'primitives: raw values, no meaning. Use the semantic layer in product code.',
    color: { raw: palette.tree((hex) => colV(hex)) },
    space, radius, font: { family, weight },
  };
  if (model.shadows.length) primitive.shadow = shadow;
  primitive.duration = duration;
  primitive.easing = easing;
  if (model.zIndex.length) primitive.z = z;

  const rdMd = rn[Math.min(1, rn.length - 1)]?.name ?? 'md';
  const rdLg = rn[Math.min(2, rn.length - 1)]?.name ?? 'lg';
  const ref = (s: string): JsonObject => ({ $value: `{${s}}` });
  const component: JsonObject = {
    $description: 'component tokens: references to semantic tokens only.',
    button: {
      primary: { bg: { $type: 'color', ...ref('color.primary') }, fg: { $type: 'color', ...ref('color.on-primary') } },
      secondary: { bg: { $type: 'color', ...ref('color.secondary') }, fg: { $type: 'color', ...ref('color.text') } },
      radius: { $type: 'dimension', ...ref(`radius.${rdMd}`) },
    },
    input: { bg: { $type: 'color', ...ref('color.background') }, fg: { $type: 'color', ...ref('color.text') }, border: { $type: 'color', ...ref('color.border-strong') }, radius: { $type: 'dimension', ...ref(`radius.${rdMd}`) } },
    card: { bg: { $type: 'color', ...ref('color.surface') }, border: { $type: 'color', ...ref('color.border') }, radius: { $type: 'dimension', ...ref(`radius.${rdLg}`) } },
  };

  const files: DtcgFiles = {
    'primitive.json': primitive,
    'semantic.json': { $description: 'semantic: type roles.', type },
    'semantic.color.light.json': light,
  };
  if (dark) files['semantic.color.dark.json'] = dark;
  files['component.json'] = component;
  return legacy ? toLegacy(model, files, colV) : files;
}

// ───────────── --dtcg-legacy: the layout equipe's design/scripts/build.mjs reads ─────────────
const tpl = (f: string): JsonObject => JSON.parse(readFileSync(new URL(`../templates/${f}`, import.meta.url), 'utf8')) as JsonObject;

function legacyColors(c: Record<RoleName, string>, dark: boolean, colV: (hex: string, a?: number) => Json): JsonObject {
  const T = c.text;
  const B = c.background;
  const act = c.accent;
  const toward = dark ? '#ffffff' : '#000000';
  const out: Record<string, Json> = {
    bg: colV(B), surface: colV(c.surface), raised: colV(c.raised), sunken: colV(sunkenOf(c, dark ? 'dark' : 'light')),
    text: colV(T), muted: colV(c['muted-text']), accent: colV(act), 'on-accent': colV(bestOn(act)),
    'accent-bg': colV(act, tintAlpha(c, 'accent', TINT_ALPHA.selected)), focus: colV(c.ring), dot: colV(c['muted-text']), line: colV(c.border), 'border-strong': colV(c['border-strong']),
    action: colV(c.primary), 'on-action': colV(c['on-primary']),
    'action-hover': colV(mix(c.primary, toward, 0.12)), 'action-pressed': colV(mix(c.primary, toward, 0.22)),
    hover: colV(T, 0.06), pressed: colV(T, 0.1), scrim: colV('#000000', dark ? 0.6 : 0.4),
    inverse: colV(T), 'on-inverse': colV(B), 'inverse-accent': colV(mix(act, dark ? '#000000' : '#ffffff', 0.4)),
    ok: colV(c.success), 'ok-bg': colV(c.success, tintAlpha(c, 'success')), work: colV(act), 'work-bg': colV(act, tintAlpha(c, 'accent')), wait: colV(c.warning), 'wait-bg': colV(c.warning, tintAlpha(c, 'warning')),
    err: colV(c.destructive), 'err-bg': colV(c.destructive, tintAlpha(c, 'destructive')), 'on-err': colV(bestOn(c.destructive)),
  };
  const color: JsonObject = { $type: 'color' };
  for (const [k, v] of Object.entries(out)) color[k] = { $value: v };
  return { $description: 'semantic colour, from the remixed roles.', color };
}

function toLegacy(model: Model, files: DtcgFiles, colV: (hex: string, a?: number) => Json): DtcgFiles {
  if (!model.colors.dark) throw new Error("--dtcg-legacy needs a dark theme: equipe's build reads light and dark, and this source has no dark colours");
  const prim = tpl('primitive.json');
  const mine = (files['primitive.json'] as JsonObject).color as JsonObject;
  const alpha = ((prim.color as JsonObject).raw as JsonObject).alpha as Json;
  prim.color = { $type: 'color', raw: { ...(mine.raw as JsonObject), alpha } };
  const fam = (prim.font as JsonObject).family as JsonObject;
  (fam.sans as JsonObject).$value = model.fonts.sans;
  (fam.mono as JsonObject).$value = model.fonts.mono;
  const r = model.radius;
  const rad = prim.radius as JsonObject;
  let prev = 0;
  ['sm', 'md', 'lg', 'xl', 'xxl'].forEach((n, i) => {
    const px = Math.max(i ? prev + 1 : 0, r[Math.min(r.length - 1, Math.round((i / 4) * (r.length - 1)))]!);
    prev = px;
    (rad[n] as JsonObject).$value = `${px}px`;
  });
  return {
    'primitive.json': prim,
    'semantic.json': tpl('semantic.json'),
    'semantic.color.light.json': legacyColors(model.colors.light, false, colV),
    'semantic.color.dark.json': legacyColors(model.colors.dark, true, colV),
    'component.json': tpl('component.json'),
  };
}

// ───────────── tokens.json: the one file `equipe design check` and equipe's design screen read ─────────────
// What equipe's design/scripts/build.mjs makes from the legacy layout: the light tree as written (aliases kept),
// and where a token's dark value differs, that value in $extensions.mode.dark. Roles come before the raw palette.
const isToken = (n: unknown): n is JsonObject => !!n && typeof n === 'object' && !Array.isArray(n) && '$value' in n;

function mergeTree(a: JsonObject, b: JsonObject): JsonObject {
  for (const [k, v] of Object.entries(b)) {
    const at = a[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !isToken(v) && at && typeof at === 'object' && !Array.isArray(at)) mergeTree(at, v);
    else a[k] = v;
  }
  return a;
}

export function equipeTokensJson(files: DtcgFiles): JsonObject {
  const tree = (mode: 'light' | 'dark'): JsonObject => {
    const out: JsonObject = {};
    for (const f of ['primitive.json', 'semantic.json', `semantic.color.${mode}.json`, 'component.json']) {
      const part = files[f];
      if (!part) throw new Error(`tokens.json: ${f} is missing`);
      mergeTree(out, structuredClone(part) as JsonObject);
    }
    return out;
  };
  const light = tree('light');
  const dark = tree('dark');
  const walk = (l: JsonObject, d: JsonObject | undefined, at: string[]) => {
    for (const k of Object.keys(d ?? {})) if (!k.startsWith('$') && !(k in l)) throw new Error(`tokens.json: ${[...at, k].join('.')} is in dark only`);
    for (const [k, v] of Object.entries(l)) {
      if (k.startsWith('$') || !v || typeof v !== 'object' || Array.isArray(v)) continue;
      const dv = d?.[k] as JsonObject | undefined;
      if (!isToken(v)) {
        walk(v, dv, [...at, k]);
        continue;
      }
      if (!isToken(dv)) throw new Error(`tokens.json: ${[...at, k].join('.')} is in light only`);
      if (JSON.stringify(v.$value) !== JSON.stringify(dv.$value)) v.$extensions = { ...((v.$extensions as JsonObject | undefined) ?? {}), mode: { dark: dv.$value as Json } };
    }
  };
  walk(light, dark, []);
  const groups = { ...light };
  delete groups.$description;
  const color = groups.color as JsonObject | undefined;
  if (color && 'raw' in color) {
    const { raw, ...roles } = color;
    groups.color = { ...roles, raw };
  }
  return { $description: 'design tokens — light is $value; dark is $extensions.mode.dark. Written by equipe-design emit --dtcg-legacy from dtcg/*.json.', ...groups };
}

/** The reverse of toDtcg for files in its layout: lets `emit` re-write a tokens folder (for example as legacy). */
export function modelFromResolved(r: Resolved): Model {
  const val = <T>(list: Token[], name: string): T | undefined => list.find((t) => t.name === name)?.value as T | undefined;
  const roles = (list: Token[] | null): Record<RoleName, string> | null => {
    if (!list) return null;
    const out = {} as Record<RoleName, string>;
    for (const role of ROLES) {
      const c = val<Rgba>(list, `color.${role}`);
      if (!c) throw new Error(`color.${role} is missing`);
      out[role] = c.hex;
    }
    return out;
  };
  const under = (p: string) => r.light.filter((t) => t.name.startsWith(p + '.') && !t.name.startsWith(p + '.raw'));
  const type: Model['type'] = {};
  for (const role of TYPE_ROLES) {
    const t = val<Typo>(r.light, `type.${role}`);
    if (t) {
      const sans = val<string[]>(r.light, 'font.family.sans') ?? [];
      const display = val<string[]>(r.light, 'font.family.display');
      type[role] = { family: t.mono ? 'mono' : display && t.family.join() === display.join() && display.join() !== sans.join() ? 'display' : 'sans', size: t.size, weight: t.weight, lineHeight: round(t.line / t.size, 4), letterSpacing: round(t.tracking, 4) };
    }
  }
  const nums = (p: string) => under(p).map((t) => t.value as number);
  return {
    colors: { light: roles(r.light)!, dark: roles(r.dark) },
    provenance: { light: {}, dark: {} },
    fonts: { sans: val<string[]>(r.light, 'font.family.sans') ?? [], mono: val<string[]>(r.light, 'font.family.mono') ?? [], display: val<string[]>(r.light, 'font.family.display') ?? null },
    type,
    space: nums('space'),
    radius: under('radius').filter((t) => t.path[1] !== 'full').map((t) => t.value as number).sort((a, b) => a - b),
    shadows: under('shadow').map((t) => (t.value as ShadowV[]).map((s) => ({ offsetX: s.x, offsetY: s.y, blur: s.blur, spread: s.spread, color: s.color.hex, alpha: s.color.a, inset: s.inset }))),
    motion: {
      durations: [val<number>(r.light, 'duration.fast') ?? 0, val<number>(r.light, 'duration.base') ?? 120, val<number>(r.light, 'duration.slow') ?? 200],
      easing: (val<number[]>(r.light, 'easing.standard') ?? [0.2, 0, 0, 1]) as [number, number, number, number],
    },
    zIndex: nums('z'),
  };
}
