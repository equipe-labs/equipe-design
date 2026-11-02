// Reads DTCG files (2025.10 objects or the older strings), resolves {references}, and gives back flat, typed tokens.
import { parseHex, toHex } from '@equipe-design/remix';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };
/** File name -> parsed JSON. */
export type DtcgFiles = Record<string, JsonObject>;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
  /** '#rrggbb' */
  hex: string;
}
export interface Typo {
  family: string[];
  /** px */
  size: number;
  /** px */
  line: number;
  weight: number;
  /** em */
  tracking: number;
  mono: boolean;
}
export interface ShadowV {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: Rgba;
  inset: boolean;
}
export type Value = Rgba | number | string[] | number[] | Typo | ShadowV[];

export interface Token {
  path: string[];
  name: string;
  type: 'color' | 'dimension' | 'duration' | 'number' | 'fontFamily' | 'fontWeight' | 'cubicBezier' | 'typography' | 'shadow';
  value: Value;
  /** The token this one points at, when it was written as a plain {reference}. */
  ref: string | null;
  source: JsonObject | null;
}

const isObj = (n: unknown): n is JsonObject => !!n && typeof n === 'object' && !Array.isArray(n);
const isLeaf = (n: unknown): n is JsonObject => isObj(n) && '$value' in n;

function merge(a: JsonObject, b: JsonObject): JsonObject {
  for (const [k, v] of Object.entries(b)) {
    const cur = a[k];
    if (isObj(v) && !('$value' in v) && isObj(cur) && !('$value' in cur)) merge(cur, v);
    else a[k] = v;
  }
  return a;
}

interface Raw {
  path: string[];
  type: string;
  value: Json;
  node: JsonObject;
}

function flatten(node: JsonObject, path: string[], inherited: string | undefined, out: Raw[]): void {
  const type = typeof node.$type === 'string' ? node.$type : inherited;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$') || !isObj(v)) continue;
    if (isLeaf(v)) {
      const t = typeof v.$type === 'string' ? v.$type : type;
      if (!t) throw new Error(`token ${[...path, k].join('.')} has no $type`);
      out.push({ path: [...path, k], type: t, value: v.$value as Json, node: v });
    } else flatten(v, [...path, k], type, out);
  }
}

const num = (v: Json | undefined): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  if (isObj(v) && 'value' in v) return dim(v);
  return NaN;
};
function dim(v: Json | undefined): number {
  if (isObj(v)) return v.unit === 'rem' ? Number(v.value) * 16 : Number(v.value);
  if (typeof v === 'string') return /rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v);
  return Number(v);
}
function dur(v: Json | undefined): number {
  if (isObj(v)) return v.unit === 's' ? Number(v.value) * 1000 : Number(v.value);
  if (typeof v === 'string') return /ms$/.test(v) ? parseFloat(v) : /s$/.test(v) ? parseFloat(v) * 1000 : parseFloat(v);
  return Number(v);
}
function color(v: Json | undefined): Rgba {
  if (typeof v === 'string') {
    const c = parseHex(v);
    return { r: c.r, g: c.g, b: c.b, a: c.a, hex: toHex(c.r, c.g, c.b) };
  }
  if (isObj(v) && Array.isArray(v.components)) {
    const [r, g, b] = (v.components as number[]).map((x) => Math.round(Number(x) * 255)) as [number, number, number];
    return { r, g, b, a: typeof v.alpha === 'number' ? v.alpha : 1, hex: toHex(r, g, b) };
  }
  throw new Error(`not a colour: ${JSON.stringify(v)}`);
}
const letter = (v: Json | undefined, size: number): number => {
  if (v === undefined) return 0;
  if (isObj(v)) return v.unit === 'em' ? Number(v.value) : dim(v) / size;
  if (typeof v === 'string') return /em$/.test(v) ? parseFloat(v) : parseFloat(v) / size;
  return Number(v);
};

/** Resolves every {reference}, deeply, until none is left. */
function makeResolver(raws: Raw[]) {
  const byName = new Map(raws.map((r) => [r.path.join('.'), r]));
  const resolve = (v: Json, seen: string[]): Json => {
    if (typeof v === 'string') {
      const m = /^\{([^}]+)\}$/.exec(v);
      if (!m) return v;
      const name = m[1]!;
      if (seen.includes(name)) throw new Error(`reference loop: ${[...seen, name].join(' -> ')}`);
      const target = byName.get(name);
      if (!target) throw new Error(`unknown reference {${name}}`);
      return resolve(target.value, [...seen, name]);
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, seen));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, seen)]));
    return v;
  };
  return (v: Json) => resolve(v, []);
}

function normalize(type: string, v: Json, name: string): Value {
  switch (type) {
    case 'color': return color(v);
    case 'dimension': return dim(v);
    case 'duration': return dur(v);
    case 'number': case 'fontWeight': return num(v);
    case 'cubicBezier': return (v as number[]).map(Number);
    case 'fontFamily': return Array.isArray(v) ? (v as string[]) : [String(v)];
    case 'typography': {
      const t = v as JsonObject;
      const size = dim(t.fontSize);
      const lh = isObj(t.lineHeight) || (typeof t.lineHeight === 'string' && /px|rem$/.test(t.lineHeight)) ? dim(t.lineHeight) : Number(t.lineHeight) * size;
      const family = Array.isArray(t.fontFamily) ? (t.fontFamily as string[]) : [String(t.fontFamily)];
      return { family, size, line: lh, weight: Number(t.fontWeight), tracking: letter(t.letterSpacing, size), mono: family.some((f) => /mono|menlo|courier/i.test(f)) };
    }
    case 'shadow': {
      const list = Array.isArray(v) ? v : [v];
      return (list as JsonObject[]).map((s) => ({ x: dim(s.offsetX), y: dim(s.offsetY), blur: dim(s.blur), spread: dim(s.spread), color: color(s.color), inset: s.inset === true }));
    }
    default: throw new Error(`token ${name}: unsupported $type ${type}`);
  }
}

export interface Resolved {
  light: Token[];
  /** null when no dark file was given. */
  dark: Token[] | null;
}

const SEMANTIC_COLOR = /^semantic\.color\.(light|dark)\.json$/;

export function resolveFiles(files: DtcgFiles): Resolved {
  const shared: JsonObject = {};
  const modes: Record<'light' | 'dark', JsonObject | null> = { light: null, dark: null };
  for (const [name, tree] of Object.entries(files)) {
    const m = SEMANTIC_COLOR.exec(name);
    if (m) modes[m[1] as 'light' | 'dark'] = tree;
    else if (name.endsWith('.json')) merge(shared, structuredClone(tree));
  }
  if (!modes.light) throw new Error('semantic.color.light.json is missing');
  const build = (modeTree: JsonObject): Token[] => {
    const tree = merge(structuredClone(shared), structuredClone(modeTree));
    const raws: Raw[] = [];
    flatten(tree, [], undefined, raws);
    const resolve = makeResolver(raws);
    return raws.map((r) => {
      const name = r.path.join('.');
      const refm = typeof r.value === 'string' ? /^\{([^}]+)\}$/.exec(r.value) : null;
      return { path: r.path, name, type: r.type as Token['type'], value: normalize(r.type, resolve(r.value), name) as Value, ref: refm ? refm[1]! : null, source: r.node };
    });
  };
  return { light: build(modes.light), dark: modes.dark ? build(modes.dark) : null };
}
