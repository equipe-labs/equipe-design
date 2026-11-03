import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FORMATS, emit, type DtcgFiles, type Format } from '@equipe-design/emit';
import { ArgError, optStr, path, strList } from '../args.ts';
import type { Tool } from '../tool.ts';

export const tool: Tool = {
  name: 'design_emit',
  description:
    `Write a remix's tokens as ${FORMATS.join(', ')}. dtcgLegacy writes the layout equipe's design/ folder reads ` +
    "plus the one tokens.json equipe reads (then run `equipe design check` on outDir). Fails when a source site's name would end up in a token or file name.",
  inputSchema: {
    type: 'object',
    properties: {
      tokensDir: { type: 'string', description: 'A variant\'s tokens/ folder from design_remix.' },
      formats: { type: 'array', items: { enum: [...FORMATS] }, minItems: 1 },
      outDir: { type: 'string' },
      prefix: { type: 'string', description: 'CSS variable / type prefix, default eq.' },
      dtcgLegacy: { type: 'boolean' },
    },
    required: ['tokensDir', 'formats', 'outDir'],
    additionalProperties: false,
  },
  async handler(args) {
    const dir = path(args, 'tokensDir');
    const formats = strList(args, 'formats') as Format[];
    for (const f of formats) if (!FORMATS.includes(f)) throw new ArgError(`unknown format "${f}"; use ${FORMATS.join(', ')}`);
    const outDir = path(args, 'outDir');
    const prefix = optStr(args, 'prefix');
    const files: DtcgFiles = {};
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) files[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DtcgFiles[string];
    const meta = join(dirname(dir), 'remix.json');
    const forbidden = existsSync(meta) ? ((JSON.parse(readFileSync(meta, 'utf8')) as { forbiddenLabels?: string[] }).forbiddenLabels ?? []) : [];
    const result = emit(files, formats, { forbidden, ...(prefix ? { prefix } : {}), legacy: args.dtcgLegacy === true });
    const written: string[] = [];
    for (const [name, text] of Object.entries(result)) {
      const file = resolve(outDir, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      written.push(file);
    }
    return { files: written };
  },
};
