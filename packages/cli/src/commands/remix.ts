import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadSource, remix, renderSheet, RemixError, type Source } from '@equipe-design/remix';
import { toDtcg } from '@equipe-design/emit';
import type { Command } from '../command.ts';

const USAGE = [
  'Usage: equipe-design remix <extract.json|tokens.json...> --brand "#hex" --name <name> --out DIR',
  '         [--variants 1-3] [--font-alt] [--keep-brand --own-site] [--no-sheet]',
  '',
  'Inputs are extract.json files (up to 3, mixed role by role) or library tokens.json files.',
  'Writes DIR/<a|b|c>/tokens/*.json (DTCG), DIR/<a|b|c>/remix.json and a review sheet DIR/<a|b|c>/sheet.png.',
  'Exit code: 0 ok, 2 refused by a guardrail (--keep-brand without --own-site), 1 error or a contrast check that fails.',
].join('\n');

interface Parsed {
  inputs: string[];
  flags: Map<string, string | true>;
}
const VALUE_FLAGS = new Set(['brand', 'name', 'out', 'variants']);
function parse(args: string[]): Parsed {
  const inputs: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      if (VALUE_FLAGS.has(k)) {
        const v = inline ?? args[++i];
        if (v === undefined) throw new RemixError(`--${k} needs a value`);
        flags.set(k, v);
      } else flags.set(k, true);
    } else inputs.push(a);
  }
  return { inputs, flags };
}

export const command: Command = {
  name: 'remix',
  summary: 'Recolor extracted or library tokens with your brand color (1-3 variants, AA contrast checked)',
  usage: USAGE,
  async run(args) {
    try {
      const { inputs, flags } = parse(args);
      const known = new Set([...VALUE_FLAGS, 'font-alt', 'keep-brand', 'own-site', 'no-sheet']);
      for (const k of flags.keys()) if (!known.has(k)) throw new RemixError(`unknown option --${k}`);
      if (!inputs.length) throw new RemixError('give at least one extract.json or tokens.json');
      const out = flags.get('out');
      const name = flags.get('name');
      if (typeof out !== 'string') throw new RemixError('--out DIR is required');
      if (typeof name !== 'string') throw new RemixError('--name <your brand> is required');
      const sources: Source[] = inputs.map((p) => loadSource(JSON.parse(readFileSync(resolve(p), 'utf8'))));
      const variants = flags.get('variants') ? Number(flags.get('variants')) : 3;
      if (!Number.isInteger(variants) || variants < 1 || variants > 3) throw new RemixError('--variants must be 1, 2 or 3');
      const brand = typeof flags.get('brand') === 'string' ? (flags.get('brand') as string) : undefined;
      const results = remix(sources, { ...(brand ? { color: brand } : {}), name }, {
        variants, fontAlt: flags.has('font-alt'), keepBrand: flags.has('keep-brand'), ownSite: flags.has('own-site'),
      });
      let failed = 0;
      for (const r of results) {
        const dir = resolve(out, r.id);
        mkdirSync(join(dir, 'tokens'), { recursive: true });
        for (const [file, tree] of Object.entries(toDtcg(r))) writeFileSync(join(dir, 'tokens', file), JSON.stringify(tree, null, 2) + '\n');
        const { forbiddenLabels, ...rest } = r;
        writeFileSync(join(dir, 'remix.json'), JSON.stringify({ ...rest, model: undefined, forbiddenLabels }, null, 2) + '\n');
        const sheet = flags.has('no-sheet') ? null : renderSheet(r, join(dir, 'sheet.png')) ? join(dir, 'sheet.png') : null;
        failed += r.contrast.fails.length;
        process.stdout.write(`${r.id}  ${r.label}\n    brand ${r.meta.brand.applied}  contrast ${r.contrast.fails.length} fails / ${r.contrast.checked}  -> ${dir}${sheet ? '' : '  (no sheet)'}\n`);
      }
      if (failed) {
        process.stderr.write(`equipe-design: ${failed} contrast check(s) below AA, see remix.json\n`);
        return 1;
      }
      return 0;
    } catch (e) {
      if (e instanceof RemixError) {
        process.stderr.write(`equipe-design remix: ${e.message}\n`);
        return /own-site/.test(e.message) ? 2 : 1;
      }
      process.stderr.write(`equipe-design remix: ${(e as Error).message}\n`);
      return 1;
    }
  },
};
