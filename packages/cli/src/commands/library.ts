import { join, relative, resolve } from 'node:path';
import { createClient, LibraryError, type LibraryClient, type StyleQuery } from '@equipe-design/client';
import {
  isRemixDir, LocalError, parseFormats, pullRemixDir, pullStyle, PULL_FORMATS, remixStyles, REMIX_OUT_FORMATS,
} from '@equipe-design/client/local';
import { RemixError } from '@equipe-design/remix';
import { EmitError } from '@equipe-design/emit';
import type { Command } from '../command.ts';

const USAGE = [
  'Usage: equipe-design library list [--q text] [--category c] [--tag t] [--origin extracted|original] [--dark] [--hue 0-359] [--json]',
  '       equipe-design library show <style> [--json]',
  '       equipe-design library remix <style...> --brand "#rrggbb" [--name "My Brand"] [--prefix eq] [--variants 1-3]',
  `                                  [--to ${REMIX_OUT_FORMATS.join(',')}] [--out DIR] [--font-alt] [--no-sheet]`,
  `       equipe-design library pull <style|remix-dir> [--to ${PULL_FORMATS.join(',')}] [--out DIR] [--prefix eq]`,
  '',
  'Pick a style, make it your colour, take the code:',
  '  equipe-design library list',
  '  equipe-design library remix hush --brand "#0f766e"      # → design-library/hush-remix/a|b|c',
  '  equipe-design library pull design-library/hush-remix/a --to css,tailwind,swift',
  '',
  'remix runs on this machine from the style\'s DTCG tokens (no POST /remix). pull <style> takes the original style.',
  'The library address is $EQUIPE_DESIGN_API (default https://equipe.im/api/design/v1).',
].join('\n');

const VALUE = new Set(['q', 'category', 'tag', 'origin', 'hue', 'brand', 'name', 'prefix', 'variants', 'to', 'out']);
const BOOL = new Set(['json', 'dark', 'font-alt', 'no-sheet']);

function parse(args: string[]): { pos: string[]; flags: Map<string, string | true> } {
  const pos: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (VALUE.has(k)) {
      const v = inline ?? args[++i];
      if (v === undefined) throw new LocalError(`--${k} needs a value`);
      flags.set(k, v);
    } else if (BOOL.has(k)) flags.set(k, true);
    else throw new LocalError(`unknown option --${k}`);
  }
  return { pos, flags };
}

const out = (s: string) => process.stdout.write(s);
const str = (flags: Map<string, string | true>, k: string): string | undefined => {
  const v = flags.get(k);
  return typeof v === 'string' ? v : undefined;
};
const rel = (p: string) => relative(process.cwd(), p) || '.';

async function list(client: LibraryClient, flags: Map<string, string | true>): Promise<number> {
  const query: StyleQuery = {};
  for (const k of ['q', 'category', 'tag'] as const) if (str(flags, k)) query[k] = str(flags, k);
  const origin = str(flags, 'origin');
  if (origin) {
    if (origin !== 'extracted' && origin !== 'original') throw new LocalError('--origin is extracted or original');
    query.origin = origin;
  }
  if (flags.has('dark')) query.hasDark = true;
  if (str(flags, 'hue')) {
    const hue = Number(str(flags, 'hue'));
    if (!Number.isFinite(hue) || hue < 0 || hue >= 360) throw new LocalError('--hue is 0 to 359');
    query.hue = hue;
  }
  const res = await client.listStyles(query);
  if (flags.has('json')) { out(JSON.stringify(res, null, 2) + '\n'); return 0; }
  if (!res.styles.length) { out('No styles match.\n'); return 0; }
  const rows = res.styles.map((s) => [s.slug, s.name, s.category, s.brand.hex ?? '-', s.hasDark ? 'light+dark' : 'light', s.fonts.slice(0, 2).join(', ')]);
  const head = ['STYLE', 'NAME', 'CATEGORY', 'BRAND', 'MODES', 'FONTS'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  for (const r of [head, ...rows]) out(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]!))).join('  ') + '\n');
  out(`\n${res.styles.length} of ${res.total}. Next: equipe-design library remix <style> --brand "#rrggbb"\n`);
  return 0;
}

async function show(client: LibraryClient, slug: string | undefined, flags: Map<string, string | true>): Promise<number> {
  if (!slug) throw new LocalError('give a style, e.g. `library show hush`');
  const d = await client.getStyle(slug);
  if (flags.has('json')) { out(JSON.stringify(d, null, 2) + '\n'); return 0; }
  const r = d.release;
  out(`${d.style.name} (${d.style.slug}) · ${d.style.category} · v${r.version}\n`);
  if (d.style.description) out(`${d.style.description}\n`);
  out(`\nfonts    ${[...r.typography.fonts.sans.slice(0, 1), ...r.typography.fonts.mono.slice(0, 1)].join(' / ')}\n`);
  for (const mode of ['light', 'dark'] as const) {
    const c = r.roles[mode];
    if (c) out(`${mode.padEnd(8)} background ${c.background}  text ${c.text}  primary ${c.primary}  accent ${c.accent}  border ${c.border}\n`);
  }
  out(`formats  ${r.formats.join(', ')} (+ swift, kotlin from the CLI)\n`);
  if (r.limits.length) out(`limits   ${r.limits.map((l) => `${l.scope}: ${l.text}`).join('\n         ')}\n`);
  out(`\n${d.notice}\n`);
  return 0;
}

async function pull(client: LibraryClient, target: string | undefined, flags: Map<string, string | true>): Promise<number> {
  if (!target) throw new LocalError('give a style or a folder `library remix` wrote, e.g. `library pull hush`');
  const prefix = str(flags, 'prefix') ?? 'eq';
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new LocalError('--prefix is a-z, 0-9 and -, up to 32, starting with a letter');
  if (isRemixDir(resolve(target))) {
    const formats = parseFormats(str(flags, 'to') ?? 'css', REMIX_OUT_FORMATS);
    const dest = resolve(str(flags, 'out') ?? target);
    const files = pullRemixDir(resolve(target), formats, dest, prefix);
    for (const [f, paths] of Object.entries(files)) out(`${f.padEnd(11)} ${paths.map(rel).join(', ')}\n`);
    return 0;
  }
  const formats = parseFormats(str(flags, 'to') ?? 'dtcg,css', PULL_FORMATS);
  const dest = resolve(str(flags, 'out') ?? join('design-library', target));
  const res = await pullStyle(client, target, formats, dest, prefix);
  out(`${res.name} v${res.version} → ${rel(res.outDir)}\n`);
  for (const [f, paths] of Object.entries(res.files)) out(`  ${f.padEnd(11)} ${paths!.map((p) => relative(res.outDir, p)).join(', ')}\n`);
  out(`\n${res.notice}\n`);
  return 0;
}

async function remixCmd(client: LibraryClient, slugs: string[], flags: Map<string, string | true>): Promise<number> {
  if (!slugs.length) throw new LocalError('give 1 to 3 styles, e.g. `library remix hush --brand "#0f766e"`');
  const brand = str(flags, 'brand');
  if (!brand) throw new LocalError('give your brand colour with --brand "#rrggbb"');
  const variants = str(flags, 'variants') ? Number(str(flags, 'variants')) : 3;
  if (!Number.isInteger(variants) || variants < 1 || variants > 3) throw new LocalError('--variants must be 1, 2 or 3');
  const prefix = str(flags, 'prefix') ?? 'eq';
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new LocalError('--prefix is a-z, 0-9 and -, up to 32, starting with a letter');
  const dest = resolve(str(flags, 'out') ?? join('design-library', `${slugs.join('+')}-remix`));
  const res = await remixStyles(client, slugs, {
    brand, name: str(flags, 'name') ?? 'My Brand', prefix, variants,
    fontAlt: flags.has('font-alt'), sheet: !flags.has('no-sheet'),
    formats: parseFormats(str(flags, 'to') ?? 'css', REMIX_OUT_FORMATS),
  }, dest);
  let failed = 0;
  for (const v of res.variants) {
    failed += v.contrastFails;
    out(`${v.id}  ${v.label}\n    brand ${v.brandApplied}  contrast ${v.contrastFails} fails / ${v.contrastChecked}  -> ${rel(v.dir)}${v.sheetPath ? '' : '  (no sheet)'}\n`);
  }
  out(`\nNext: equipe-design library pull ${rel(res.variants[0]!.dir)} --to css,tailwind,shadcn,swift,kotlin\n`);
  if (failed) {
    process.stderr.write(`equipe-design: ${failed} contrast check(s) below AA, see remix.json\n`);
    return 1;
  }
  return 0;
}

export const command: Command = {
  name: 'library',
  summary: 'Browse the equipe design library, remix a style with your brand colour, and pull its code',
  usage: USAGE,
  async run(args) {
    const [sub, ...rest] = args;
    try {
      const { pos, flags } = parse(rest);
      const client = createClient();
      switch (sub) {
        case 'list': return await list(client, flags);
        case 'show': return await show(client, pos[0], flags);
        case 'pull': return await pull(client, pos[0], flags);
        case 'remix': return await remixCmd(client, pos, flags);
        default:
          process.stderr.write(`${sub ? `equipe-design library: unknown subcommand "${sub}"\n\n` : ''}${USAGE}\n`);
          return 1;
      }
    } catch (e) {
      const known = e instanceof LibraryError || e instanceof LocalError || e instanceof RemixError || e instanceof EmitError;
      process.stderr.write(`equipe-design library: ${known ? e.message : `${(e as Error).message}`}\n`);
      return 1;
    }
  },
};
