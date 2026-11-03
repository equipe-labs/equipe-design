/**
 * Read each tool's output folder into a ToolResult. Folder layout (same as T-257 `원본출력/`):
 *   <root>/equipe-design/<host>/extract.json
 *   <root>/designlang/<host>/{design-tokens,figma-variables,dark-mode,…}.json + status.txt
 *   <root>/dembrandt/<host>/{light,dark-merged}/*_v0.39.2.json + status.txt
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Extraction } from '@equipe-design/schema';
import { figmaHex, scanColors, toHex } from './color.ts';
import type { ToolName, ToolResult } from './types.ts';

const px = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  return m ? +m[1]! : null;
};

function empty(tool: ToolName, host: string, status: ToolResult['status'], error?: string): ToolResult {
  return {
    tool, host, status, error, secs: null, colors: [], darkColors: null, spacing: null, radius: null,
    families: null, fontSizes: null, pairs: null, darkByVar: null, darkByRole: null, brand: null, darkOnly: null,
  };
}

function readJson<T = unknown>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

/** Every file under dir (recursively) whose name ends in .json or .css. */
function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...textFiles(p));
    else if (/\.(json|css)$/.test(f)) out.push(p);
  }
  return out;
}

function scanDir(dir: string): string[] {
  const all = new Set<string>();
  for (const f of textFiles(dir)) for (const c of scanColors(readFileSync(f, 'utf8'))) all.add(c);
  return [...all];
}

function statusSecs(dir: string): { exit: number | null; secs: number | null } {
  const p = join(dir, 'status.txt');
  if (!existsSync(p)) return { exit: null, secs: null };
  const t = readFileSync(p, 'utf8');
  const e = /exit=(\d+)/.exec(t);
  const s = /secs=(\d+(?:\.\d+)?)/.exec(t);
  return { exit: e ? +e[1]! : null, secs: s ? +s[1]! : null };
}

type Dtcg = Record<string, { $value?: unknown }>;

export function readDesignlang(root: string, host: string): ToolResult {
  const dir = join(root, 'designlang', host);
  if (!existsSync(join(dir, 'design-tokens.json'))) return empty('designlang', host, 'missing');
  const st = statusSecs(dir);
  const r = empty('designlang', host, st.exit && st.exit !== 0 ? 'error' : 'ok');
  r.secs = st.secs;
  r.colors = scanDir(dir);
  const tok = readJson<{ primitive: Record<string, Dtcg> & { color?: Record<string, Dtcg> } }>(join(dir, 'design-tokens.json'));
  const vals = (g: Dtcg | undefined) => Object.values(g ?? {}).map((t) => t.$value);
  r.spacing = vals(tok.primitive.spacing).map(px).filter((n): n is number => n !== null);
  const radius = vals(tok.primitive.radius);
  r.radius = radius.map(px).filter((n): n is number => n !== null);
  r.radiusCount = radius.length;
  r.families = vals(tok.primitive.fontFamily).filter((v): v is string => typeof v === 'string');
  r.fontSizes = vals(tok.primitive.fontSize).map(px).filter((n): n is number => n !== null);
  const brand = toHex((tok.primitive.color?.brand?.primary as { $value?: string } | undefined)?.$value);
  r.brand = brand ? { status: 'found', color: brand } : { status: 'none', color: null };

  const figmaPath = join(dir, 'figma-variables.json');
  if (existsSync(figmaPath)) {
    const fg = readJson<{ collections: { modes?: string[]; variables: { name: string; type: string; values: Record<string, { r: number; g: number; b: number }> }[] }[] }>(figmaPath);
    r.pairs = [];
    for (const c of fg.collections) {
      if (!c.modes?.includes('light') || !c.modes.includes('dark')) continue;
      for (const v of c.variables) {
        if (v.type !== 'COLOR' || !v.values.light || !v.values.dark) continue;
        r.pairs.push({ name: v.name, light: figmaHex(v.values.light), dark: figmaHex(v.values.dark) });
      }
    }
    r.pairsLabel = 'Figma 변수 기준';
  }
  const darkPath = join(dir, 'dark-mode.json');
  if (existsSync(darkPath)) {
    const dk = readJson<{ roles?: Record<string, { light?: string; dark?: string }>; variables?: { colors?: { light?: Record<string, string>; dark?: Record<string, string> } } }>(darkPath);
    const vl = dk.variables?.colors?.light ?? {};
    const vd = dk.variables?.colors?.dark ?? {};
    r.lightByVar = Object.fromEntries(Object.entries(vl).map(([k, v]) => [k, toHex(v)]));
    r.darkByVar = Object.fromEntries(Object.entries(vd).map(([k, v]) => [k, toHex(v)]));
    r.darkByRole = Object.fromEntries(Object.entries(dk.roles ?? {}).map(([k, v]) => [k, toHex(v.dark)]));
  }
  return r;
}

interface DembrandtJson {
  colors: { semantic: Record<string, string> };
  spacing: { commonValues?: { px: string }[] };
  borderRadius: { values: { value: string }[] };
  typography: { styles: { family: string; size: string }[] };
}

function dembrandtJson(dir: string): DembrandtJson | null {
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => /_v[\d.]+\.json$/.test(n) && !n.endsWith('.tokens.json'));
  return f ? readJson<DembrandtJson>(join(dir, f)) : null;
}

export function readDembrandt(root: string, host: string): ToolResult {
  const dir = join(root, 'dembrandt', host);
  const light = dembrandtJson(join(dir, 'light'));
  const dark = dembrandtJson(join(dir, 'dark-merged'));
  const base = light ?? dark;
  if (!base) return empty('dembrandt', host, 'missing');
  const st = statusSecs(join(dir, dark ? 'dark-merged' : 'light'));
  const r = empty('dembrandt', host, st.exit && st.exit !== 0 ? 'error' : 'ok');
  r.secs = st.secs;
  r.colors = scanDir(dir);
  r.spacing = (base.spacing.commonValues ?? []).map((v) => px(v.px)).filter((n): n is number => n !== null);
  r.radius = base.borderRadius.values.map((v) => px(v.value)).filter((n): n is number => n !== null);
  r.radiusCount = base.borderRadius.values.length;
  r.families = [...new Set(base.typography.styles.map((s) => s.family).filter(Boolean))];
  r.fontSizes = [...new Set(base.typography.styles.map((s) => px(s.size.split(' ')[0])).filter((n): n is number => n !== null))];
  const primary = toHex(base.colors.semantic.primary);
  r.brand = primary ? { status: 'found', color: primary } : { status: 'none', color: null };
  // No pairing: the dark run is a separate run. Its semantic colours are the tool's dark roles.
  if (dark) r.darkByRole = Object.fromEntries(Object.entries(dark.colors.semantic).map(([k, v]) => [k, toHex(v)]));
  return r;
}

export function equipeResult(x: Extraction, host: string, secs?: number): ToolResult {
  const r = empty('equipe-design', host, x.run.stoppedBy ? 'stopped' : 'ok', x.run.stoppedBy ?? undefined);
  r.secs = secs ?? x.run.durationMs / 1000;
  const byId = new Map(x.observed.color.map((c) => [c.id, c.value.hex.toLowerCase().slice(0, 7)]));
  const all = new Set(byId.values());
  // A variable's value is its declared text (`lab(…)`, `var(--x)`, …); the engine also says
  // which observed colour it resolves to, which is the value to score.
  const varHex = (v: Extraction['observed']['variables'][number], m: 'light' | 'dark') => {
    const id = v.resolvesTo?.[m];
    return (id ? byId.get(id) : undefined) ?? toHex(v.values[m]);
  };
  for (const v of x.observed.variables) {
    for (const m of ['light', 'dark'] as const) {
      const h = varHex(v, m);
      if (h) all.add(h);
    }
  }
  r.colors = [...all];
  r.darkColors = x.observed.color.filter((c) => c.mode === 'dark').map((c) => c.value.hex.toLowerCase().slice(0, 7));
  const steps = (s?: { steps: number[] }) => (s ? [...s.steps] : null);
  r.spacing = steps(x.inferred.scales?.spacing) ?? x.observed.spacing.filter((s) => s.value.unit === 'px').map((s) => s.value.value);
  r.radius = steps(x.inferred.scales?.radius) ?? x.observed.radius.filter((s) => s.value.unit === 'px').map((s) => s.value.value);
  r.radiusCount = r.radius.length;
  r.families = x.observed.typography.families.map((f) => f.name);
  r.fontSizes = steps(x.inferred.scales?.fontSize) ?? [...new Set(x.observed.typography.styles.filter((s) => s.size.unit === 'px').map((s) => s.size.value))];
  const hex = (id: string | null | undefined) => (id ? byId.get(id) ?? null : null);

  const pairs: { name?: string; light: string; dark: string }[] = [];
  const darkByRole: Record<string, string | null> = {};
  for (const role of x.inferred.roles ?? []) {
    darkByRole[role.role] = hex(role.dark);
    const l = hex(role.light);
    const d = hex(role.dark);
    if (l && d) pairs.push({ name: `role:${role.role}`, light: l, dark: d });
  }
  const darkByVar: Record<string, string | null> = {};
  const lightByVar: Record<string, string | null> = {};
  for (const v of x.observed.variables) {
    const l = varHex(v, 'light');
    const d = varHex(v, 'dark');
    lightByVar[v.name] = l;
    darkByVar[v.name] = d;
    if (l && d) pairs.push({ name: v.name, light: l, dark: d });
  }
  r.pairs = x.source.modes.dark.observed ? pairs : [];
  r.pairsLabel = '역할 + 변수';
  r.darkByRole = darkByRole;
  r.darkByVar = darkByVar;
  r.lightByVar = lightByVar;
  const b = x.inferred.brand;
  if (b) r.brand = { status: b.status, color: hex(b.color), top: hex(b.candidates[0]?.color) };
  r.darkOnly = x.limits.some((l) => l.kind === 'dark-only');
  return r;
}

export function readEquipe(root: string, host: string): ToolResult {
  const p = join(root, 'equipe-design', host, 'extract.json');
  if (!existsSync(p)) return empty('equipe-design', host, 'missing');
  const secsFile = join(root, 'equipe-design', host, 'status.txt');
  const secs = existsSync(secsFile) ? statusSecs(join(root, 'equipe-design', host)).secs ?? undefined : undefined;
  return equipeResult(readJson<Extraction>(p), host, secs);
}

export function readTool(tool: ToolName, root: string, host: string): ToolResult {
  if (tool === 'designlang') return readDesignlang(root, host);
  if (tool === 'dembrandt') return readDembrandt(root, host);
  return readEquipe(root, host);
}
