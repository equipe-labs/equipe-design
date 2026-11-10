import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSource, remix, renderSheet } from '@equipe-design/remix';
import { toDtcg } from '@equipe-design/emit';
import { ArgError, path, strList } from '../args.ts';
import type { Tool } from '../tool.ts';

export const tool: Tool = {
  name: 'design_remix',
  description:
    'Recolor 1-3 extractions (or library tokens.json files) with the brand color and name: 1-3 variants, AA contrast checked. ' +
    'Writes outDir/<id>/tokens/*.json, remix.json and sheet.png (the picture to show the person when they choose). Returns paths only.',
  inputSchema: {
    type: 'object',
    properties: {
      extractPaths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
      brand: {
        type: 'object',
        properties: { color: { type: 'string', description: '#rrggbb; omit to keep a neutral palette' }, name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      variants: { type: 'integer', minimum: 1, maximum: 3, description: 'Default 3.' },
      outDir: { type: 'string' },
      fontAlt: { type: 'boolean', description: 'Swap fonts for open (OFL) alternatives.' },
    },
    required: ['extractPaths', 'brand', 'outDir'],
    additionalProperties: false,
  },
  async handler(args) {
    const inputs = strList(args, 'extractPaths', 1, 3).map((p) => path({ p }, 'p'));
    const brand = args.brand as { color?: unknown; name?: unknown } | undefined;
    if (!brand || typeof brand.name !== 'string' || !brand.name.trim()) throw new ArgError('"brand.name" is required');
    if (brand.color !== undefined && typeof brand.color !== 'string') throw new ArgError('"brand.color" must be a #hex string');
    const variants = args.variants ?? 3;
    if (!Number.isInteger(variants) || (variants as number) < 1 || (variants as number) > 3) throw new ArgError('"variants" is 1, 2 or 3');
    const outDir = path(args, 'outDir');
    const sources = inputs.map((p) => loadSource(JSON.parse(readFileSync(p, 'utf8'))));
    const results = remix(sources, { ...(brand.color ? { color: brand.color } : {}), name: brand.name }, {
      variants: variants as number, fontAlt: args.fontAlt === true, keepBrand: false, ownSite: false,
    });
    return {
      variants: results.map((r) => {
        const dir = join(outDir, r.id);
        const tokensDir = join(dir, 'tokens');
        mkdirSync(tokensDir, { recursive: true });
        for (const [file, tree] of Object.entries(toDtcg(r))) writeFileSync(join(tokensDir, file), JSON.stringify(tree, null, 2) + '\n');
        const { forbiddenLabels, ...rest } = r;
        writeFileSync(join(dir, 'remix.json'), JSON.stringify({ ...rest, model: undefined, forbiddenLabels }, null, 2) + '\n');
        const png = join(dir, 'sheet.png');
        return {
          id: r.id,
          label: r.label,
          tokensDir,
          sheetPath: renderSheet(r, png) ? png : null,
          contrastFails: r.contrast.fails.length,
        };
      }),
    };
  },
};
