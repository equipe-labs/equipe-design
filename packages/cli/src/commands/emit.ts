import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EmitError, FORMATS, emit, type DtcgFiles, type Format } from '@equipe-design/emit';
import type { Command } from '../command.ts';

const USAGE = [
  `Usage: equipe-design emit <tokens-dir> --to ${FORMATS.join(',')} --out DIR`,
  '         [--prefix eq] [--dtcg-legacy] [--shadcn-format oklch|hsl] [--kotlin-package pkg] [--forbid label,label]',
  '',
  '<tokens-dir> holds primitive.json, semantic.json, semantic.color.light.json (and .dark.json), component.json — what `remix` writes.',
  '--dtcg-legacy writes the layout equipe\'s design/scripts/build.mjs reads (strings like "4px").',
  'Fails (exit 1) when a source site\'s label (from ../remix.json or --forbid) is in a token name or file name.',
].join('\n');

const VALUE = new Set(['to', 'out', 'prefix', 'shadcn-format', 'kotlin-package', 'forbid']);

export const command: Command = {
  name: 'emit',
  summary: 'Write tokens as DTCG, CSS, Tailwind v4, shadcn, Swift and Kotlin',
  usage: USAGE,
  async run(args) {
    try {
      const inputs: string[] = [];
      const flags = new Map<string, string | true>();
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (!a.startsWith('--')) { inputs.push(a); continue; }
        const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
        if (VALUE.has(k)) {
          const v = inline ?? args[++i];
          if (v === undefined) throw new EmitError(`--${k} needs a value`);
          flags.set(k, v);
        } else if (k === 'dtcg-legacy') flags.set(k, true);
        else throw new EmitError(`unknown option --${k}`);
      }
      const dirArg = inputs[0];
      if (!dirArg) throw new EmitError('give the tokens folder');
      const out = flags.get('out');
      const to = flags.get('to');
      if (typeof out !== 'string') throw new EmitError('--out DIR is required');
      if (typeof to !== 'string') throw new EmitError(`--to is required: ${FORMATS.join(', ')}`);
      const formats = to.split(',').map((s) => s.trim()).filter(Boolean) as Format[];
      for (const f of formats) {
        if ((f as string) === 'figma') throw new EmitError('figma is not in this version');
        if (!FORMATS.includes(f)) throw new EmitError(`unknown format "${f}"; use ${FORMATS.join(', ')}`);
      }
      const dir = resolve(dirArg);
      const files: DtcgFiles = {};
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) files[f] = JSON.parse(readFileSync(join(dir, f), 'utf8')) as DtcgFiles[string];
      const forbidden = typeof flags.get('forbid') === 'string' ? (flags.get('forbid') as string).split(',') : [];
      const meta = join(dirname(dir), 'remix.json');
      if (existsSync(meta)) forbidden.push(...((JSON.parse(readFileSync(meta, 'utf8')) as { forbiddenLabels?: string[] }).forbiddenLabels ?? []));
      const shadcnFormat = flags.get('shadcn-format');
      const result = emit(files, formats, {
        forbidden,
        ...(typeof flags.get('prefix') === 'string' ? { prefix: flags.get('prefix') as string } : {}),
        ...(typeof flags.get('kotlin-package') === 'string' ? { kotlinPackage: flags.get('kotlin-package') as string } : {}),
        ...(shadcnFormat === 'hsl' || shadcnFormat === 'oklch' ? { shadcnFormat } : {}),
        legacy: flags.has('dtcg-legacy'),
      });
      for (const [name, text] of Object.entries(result)) {
        const file = resolve(out, name);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
        process.stdout.write(`${file}\n`);
      }
      return 0;
    } catch (e) {
      process.stderr.write(`equipe-design emit: ${(e as Error).message}\n`);
      return 1;
    }
  },
};
