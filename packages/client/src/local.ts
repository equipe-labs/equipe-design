// What the CLI and MCP do with library styles on the user's own machine: pull files into a
// folder, and remix from a style's `dtcg` tokens with @equipe-design/remix — never POST /remix.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { emit, FORMATS as EMIT_FORMATS, modelFromResolved, resolveFiles, toDtcg, type DtcgFiles, type Format as EmitFormat, type JsonObject } from '@equipe-design/emit';
import { remix, renderSheet, type Remix, type Source } from '@equipe-design/remix';
import { PUBLIC_FORMATS, type LibraryClient, type PublicFormat, type StyleDetail } from './index.ts';

/** What `pull` can write: the public formats, plus Swift and Kotlin made here from `dtcg`. */
export const PULL_FORMATS = [...PUBLIC_FORMATS, 'swift', 'kotlin'] as const;
export type PullFormat = (typeof PULL_FORMATS)[number];
/** What `remix` can write (emit's formats). */
export const REMIX_OUT_FORMATS = EMIT_FORMATS;

export class LocalError extends Error {}

export function parseFormats<T extends string>(list: string, allowed: readonly T[]): T[] {
  const out = [...new Set(list.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!out.length) throw new LocalError(`give at least one format: ${allowed.join(', ')}`);
  for (const f of out) if (!allowed.includes(f as T)) throw new LocalError(`unknown format "${f}"; use ${allowed.join(', ')}`);
  return out as T[];
}

/** Writes name → text under `dir`; a name that would land outside `dir` is refused. Returns the paths written. */
export function writeFiles(dir: string, files: Record<string, string>): string[] {
  const root = resolve(dir);
  const written: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    const p = resolve(root, name);
    if (p !== root && !p.startsWith(root + sep)) throw new LocalError(`refusing to write "${name}" outside ${root}`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    written.push(p);
  }
  return written;
}

/** `dtcg/primitive.json` → `primitive.json`, parsed: what emit and modelFromResolved read. */
export function dtcgFromFiles(files: Record<string, string>): DtcgFiles {
  const out: DtcgFiles = {};
  for (const [name, text] of Object.entries(files)) {
    const base = name.split('/').pop()!;
    if (base.endsWith('.json')) out[base] = JSON.parse(text) as JsonObject;
  }
  return out;
}

/** A library style's `dtcg` tokens as a remix Source. */
export function sourceFromDtcg(tokens: DtcgFiles, style: Pick<StyleDetail['style'], 'slug' | 'origin' | 'brand'>): Source {
  const model = modelFromResolved(resolveFiles(tokens));
  const license = style.origin === 'original' ? 'OFL' : null;
  const sans = model.fonts.sans[0];
  const display = model.fonts.display?.[0];
  return {
    kind: 'library',
    label: style.slug,
    forbiddenLabels: [],
    model,
    brand: { light: style.brand.hex, dark: null },
    limits: model.colors.dark ? [] : ['dark: the style has no dark theme'],
    fonts: [
      ...(sans ? [{ name: sans, role: 'sans' as const, oflAlternatives: [], license }] : []),
      ...(display && display !== sans ? [{ name: display, role: 'display' as const, oflAlternatives: [], license }] : []),
    ],
  };
}

export interface PullResult {
  style: string;
  name: string;
  releaseId: string;
  version: number;
  outDir: string;
  /** Format → paths written. */
  files: Partial<Record<PullFormat, string[]>>;
  notice: string;
}

/** Fetches a style's current release in each format and writes it under outDir. Swift/Kotlin are emitted here. */
export async function pullStyle(client: LibraryClient, slug: string, formats: PullFormat[], outDir: string, prefix = 'eq'): Promise<PullResult> {
  const detail = await client.getStyle(slug);
  const releaseId = detail.release.id;
  const served = new Set<string>(detail.release.formats);
  const files: PullResult['files'] = {};
  let dtcg: Record<string, string> | null = null;
  const dtcgFiles = async () => (dtcg ??= (await client.getTokens({ releaseId }, 'dtcg')).files);
  for (const f of formats) {
    if (f !== 'swift' && f !== 'kotlin' && served.has(f)) {
      const got = f === 'dtcg' ? await dtcgFiles() : (await client.getTokens({ releaseId }, f as PublicFormat)).files;
      files[f] = writeFiles(outDir, got);
    } else if ((EMIT_FORMATS as readonly string[]).includes(f)) {
      files[f] = writeFiles(outDir, emit(dtcgFromFiles(await dtcgFiles()), [f as EmitFormat], { prefix }));
    } else {
      throw new LocalError(`${detail.style.name} is not served as ${f}; it has ${[...served].join(', ')}`);
    }
  }
  return { style: detail.style.slug, name: detail.style.name, releaseId, version: detail.release.version, outDir: resolve(outDir), files, notice: detail.notice };
}

/** A folder `library remix` (or `remix`) wrote: <dir>/tokens/*.json. */
export function isRemixDir(p: string): boolean {
  return existsSync(join(p, 'tokens', 'semantic.color.light.json')) && statSync(join(p, 'tokens')).isDirectory();
}

/** Emits code from a local remix folder's tokens — no network. */
export function pullRemixDir(dir: string, formats: EmitFormat[], outDir: string, prefix = 'eq'): Record<string, string[]> {
  const tokensDir = join(dir, 'tokens');
  const tokens: DtcgFiles = {};
  for (const f of readdirSync(tokensDir).filter((n) => n.endsWith('.json'))) tokens[f] = JSON.parse(readFileSync(join(tokensDir, f), 'utf8')) as JsonObject;
  let forbidden: string[] = [];
  const meta = join(dir, 'remix.json');
  if (existsSync(meta)) forbidden = (JSON.parse(readFileSync(meta, 'utf8')) as { forbiddenLabels?: string[] }).forbiddenLabels ?? [];
  const out: Record<string, string[]> = {};
  for (const f of formats) out[f] = writeFiles(outDir, emit(tokens, [f], { prefix, forbidden }));
  return out;
}

export interface LocalRemixOptions {
  /** #rrggbb */
  brand: string;
  /** Your brand's name, kept in remix.json. */
  name: string;
  /** CSS variable prefix in the code files. Default `eq`. */
  prefix?: string;
  variants?: number;
  fontAlt?: boolean;
  /** Code files to write next to tokens/ in each variant. Default css. */
  formats?: EmitFormat[];
  sheet?: boolean;
}

export interface LocalRemixVariant {
  id: string;
  label: string;
  dir: string;
  tokensDir: string;
  files: string[];
  sheetPath: string | null;
  contrastFails: number;
  contrastChecked: number;
  brandApplied: string | null;
}

/** Remixes 1–3 library styles with the user's brand on this machine. Calls only GET paths. */
export async function remixStyles(client: LibraryClient, slugs: string[], opts: LocalRemixOptions, outDir: string): Promise<{ styles: string[]; variants: LocalRemixVariant[]; notice: string[] }> {
  if (!slugs.length || slugs.length > 3) throw new LocalError('give 1 to 3 styles');
  const sources: Source[] = [];
  const notices = new Set<string>();
  for (const slug of slugs) {
    const detail = await client.getStyle(slug);
    const tokens = await client.getTokens({ releaseId: detail.release.id }, 'dtcg');
    sources.push(sourceFromDtcg(dtcgFromFiles(tokens.files), detail.style));
    notices.add(detail.notice);
  }
  const results: Remix[] = remix(sources, { color: opts.brand, name: opts.name }, {
    variants: opts.variants ?? 3, fontAlt: opts.fontAlt ?? false, keepBrand: false, ownSite: false,
  });
  const formats = (opts.formats ?? ['css']).filter((f) => f !== 'dtcg');
  const variants = results.map((r) => {
    const dir = resolve(outDir, r.id);
    const tokensDir = join(dir, 'tokens');
    const tree = toDtcg(r);
    const files = writeFiles(tokensDir, Object.fromEntries(Object.entries(tree).map(([f, t]) => [f, JSON.stringify(t, null, 2) + '\n'])));
    if (formats.length) files.push(...writeFiles(dir, emit(tree, formats, { prefix: opts.prefix ?? 'eq', forbidden: r.forbiddenLabels })));
    const { forbiddenLabels, ...rest } = r;
    writeFileSync(join(dir, 'remix.json'), JSON.stringify({ ...rest, model: undefined, forbiddenLabels, library: { styles: slugs } }, null, 2) + '\n');
    const png = join(dir, 'sheet.png');
    const sheetPath = opts.sheet === false ? null : renderSheet(r, png) ? png : null;
    return {
      id: r.id, label: r.label, dir, tokensDir, files: files.map((f) => relative(dir, f)), sheetPath,
      contrastFails: r.contrast.fails.length, contrastChecked: r.contrast.checked, brandApplied: r.meta.brand.applied,
    };
  });
  return { styles: sources.map((s) => s.label), variants, notice: [...notices] };
}
