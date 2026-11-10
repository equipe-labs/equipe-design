// The design library as three tools. Answers stay small: cards and summaries, files on disk by path.
import { relative } from 'node:path';
import { createClient } from '@equipe-design/client';
import { parseFormats, pullStyle, PULL_FORMATS, remixStyles, REMIX_OUT_FORMATS } from '@equipe-design/client/local';
import { ArgError, optStr, path, str } from '../args.ts';
import type { Tool } from '../tool.ts';

const search: Tool = {
  name: 'design_library_search',
  description:
    'Search the equipe design library (styles with our own names, e.g. "hush"). Filters: q (name/tag words), category, tag, ' +
    'origin, hasDark, hue (0-359, brand colour ±20°). Returns short cards: slug, name, category, brand hex, modes, fonts.',
  inputSchema: {
    type: 'object',
    properties: {
      q: { type: 'string' },
      category: { type: 'string' },
      tag: { type: 'string' },
      origin: { type: 'string', enum: ['extracted', 'original'] },
      hasDark: { type: 'boolean' },
      hue: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' },
    },
    additionalProperties: false,
  },
  async handler(args) {
    const q = optStr(args, 'q');
    const category = optStr(args, 'category');
    const tag = optStr(args, 'tag');
    const origin = optStr(args, 'origin');
    if (origin !== undefined && origin !== 'extracted' && origin !== 'original') throw new ArgError('"origin" is extracted or original');
    if (args.hasDark !== undefined && typeof args.hasDark !== 'boolean') throw new ArgError('"hasDark" is true or false');
    if (args.hue !== undefined && (typeof args.hue !== 'number' || args.hue < 0 || args.hue >= 360)) throw new ArgError('"hue" is 0 to 359');
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) throw new ArgError('"limit" is 1 to 50');
    const res = await createClient().listStyles({
      ...(q ? { q } : {}), ...(category ? { category } : {}), ...(tag ? { tag } : {}),
      ...(origin ? { origin } : {}),
      ...(args.hasDark !== undefined ? { hasDark: args.hasDark as boolean } : {}),
      ...(args.hue !== undefined ? { hue: args.hue as number } : {}),
    });
    return {
      total: res.total,
      styles: res.styles.slice(0, limit as number).map((s) => ({
        slug: s.slug, name: s.name, category: s.category, tags: s.tags, brand: s.brand.hex, hasDark: s.hasDark, fonts: s.fonts,
      })),
    };
  },
};

const get: Tool = {
  name: 'design_library_get',
  description:
    'One library style in brief: description, main role colours (light/dark), fonts, scales, formats, limits and the notice to show. ' +
    'Use design_library_pull to get its files or remix it.',
  inputSchema: {
    type: 'object',
    properties: { style: { type: 'string', description: 'The slug from design_library_search, e.g. "hush".' } },
    required: ['style'],
    additionalProperties: false,
  },
  async handler(args) {
    const d = await createClient().getStyle(str(args, 'style'));
    const r = d.release;
    const pick = (c: typeof r.roles.light | null) =>
      c && { background: c.background, surface: c.surface, text: c.text, 'muted-text': c['muted-text'], primary: c.primary, accent: c.accent, border: c.border };
    return {
      slug: d.style.slug, name: d.style.name, category: d.style.category, tags: d.style.tags, description: d.style.description,
      version: r.version, releaseId: r.id,
      colors: { light: pick(r.roles.light), dark: pick(r.roles.dark) },
      fonts: { sans: r.typography.fonts.sans[0] ?? null, mono: r.typography.fonts.mono[0] ?? null, display: r.typography.fonts.display?.[0] ?? null },
      space: r.scales.space, radius: r.scales.radius,
      components: r.components.map((c) => c.kind),
      formats: [...r.formats, 'swift', 'kotlin'],
      limits: r.limits.map((l) => `${l.scope}: ${l.text}`),
      notice: d.notice,
    };
  },
};

const pull: Tool = {
  name: 'design_library_pull',
  description:
    'Writes a library style into outDir. Without brand: the style as is, in formats (default dtcg,css; also tailwind, shadcn, figma, ' +
    'dtcg-legacy, swift, kotlin). With brand (#rrggbb): remixes it on this machine into 1-3 variants, each outDir/<id>/tokens/*.json, ' +
    'code files and sheet.png (show the person the sheets to choose). Returns paths and a short summary only.',
  inputSchema: {
    type: 'object',
    properties: {
      style: { type: 'string' },
      outDir: { type: 'string' },
      formats: { type: 'array', items: { type: 'string', enum: [...PULL_FORMATS] } },
      brand: { type: 'string', description: '#rrggbb. Give it to remix with your brand instead of taking the style as is.' },
      name: { type: 'string', description: 'Your brand name for the remix. Default "My Brand".' },
      prefix: { type: 'string', description: 'CSS variable / type prefix. Default "eq".' },
      variants: { type: 'integer', minimum: 1, maximum: 3, description: 'Remix variants, default 3.' },
    },
    required: ['style', 'outDir'],
    additionalProperties: false,
  },
  async handler(args) {
    const style = str(args, 'style');
    const outDir = path(args, 'outDir');
    const brand = optStr(args, 'brand');
    const prefix = optStr(args, 'prefix') ?? 'eq';
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(prefix)) throw new ArgError('"prefix" is a-z, 0-9 and -, up to 32, starting with a letter');
    if (args.formats !== undefined && (!Array.isArray(args.formats) || args.formats.some((f) => typeof f !== 'string'))) throw new ArgError('"formats" is a list of strings');
    const formatList = (args.formats as string[] | undefined)?.join(',');
    const client = createClient();
    if (!brand) {
      const res = await pullStyle(client, style, parseFormats(formatList ?? 'dtcg,css', PULL_FORMATS), outDir, prefix);
      return {
        style: res.style, name: res.name, version: res.version, outDir: res.outDir,
        files: Object.fromEntries(Object.entries(res.files).map(([f, ps]) => [f, ps!.map((p) => relative(res.outDir, p))])),
        notice: res.notice,
      };
    }
    const variants = args.variants ?? 3;
    if (!Number.isInteger(variants) || (variants as number) < 1 || (variants as number) > 3) throw new ArgError('"variants" is 1, 2 or 3');
    const res = await remixStyles(client, [style], {
      brand, name: optStr(args, 'name') ?? 'My Brand', prefix, variants: variants as number,
      formats: parseFormats(formatList ?? 'css', REMIX_OUT_FORMATS),
    }, outDir);
    return {
      style, outDir, brand,
      variants: res.variants.map((v) => ({ id: v.id, label: v.label, dir: v.dir, files: v.files, sheetPath: v.sheetPath, contrastFails: v.contrastFails })),
      notice: res.notice[0] ?? null,
    };
  },
};

export const tools: Tool[] = [search, get, pull];
