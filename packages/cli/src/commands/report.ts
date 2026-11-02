import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { validateExtraction } from '@equipe-design/schema';
import { report } from '@equipe-design/engine';
import type { Command } from '../command.ts';

const USAGE = 'Usage: equipe-design report <extract.json> [--format md|json]';

export const command: Command = {
  name: 'report',
  summary: 'Print the evidence and limits report for an extract.json',
  usage: USAGE,
  async run(args) {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { format: { type: 'string' } } });
    const file = positionals[0];
    if (!file) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      process.stderr.write(`equipe-design report: ${(e as Error).message}\n`);
      return 1;
    }
    const check = validateExtraction(data);
    if (!check.ok) {
      process.stderr.write(`equipe-design report: ${file} does not pass schema 0.1\n${check.issues.slice(0, 10).map((i) => `  ${i.kind} ${i.path}: ${i.message}`).join('\n')}\n`);
      return 1;
    }
    const x = check.value;
    if (values.format === 'json') process.stdout.write(JSON.stringify({ summary: x.summary, limits: x.limits.map((l) => ({ kind: l.kind, reason: l.reason })) }, null, 2) + '\n');
    else process.stdout.write(report(x));
    return 0;
  },
};
