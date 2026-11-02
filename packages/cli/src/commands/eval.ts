import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Command } from '../command.ts';

const USAGE = `Usage: equipe-design eval [--sites a,b] [--tools equipe-design,designlang,dembrandt] [--from DIR] [--out DIR] [--spare]

  --sites    Only these hosts from eval/sites.json (default: all but spare ones)
  --tools    Only these tools (default: all three)
  --from     Score runs already in DIR (same layout as eval/out/<date>/); runs nothing
  --out      Where runs and scoreboard.md go (default: eval/out/<date>/)
  --spare    Include spare sites (vercel.com)

Runs equipe-design, designlang 13.3.2 and Dembrandt 0.39.2 on each site of the accuracy set, scores them
against eval/answers/<host>.json and writes scoreboard.md and scores.json. It visits external sites:
run it by hand, not on a schedule. Competitors need \`npm install --prefix eval/tools\` once.
Only works from a checkout of the equipe-design repository (eval/ is not published).`;

export const command: Command = {
  name: 'eval',
  summary: 'Score equipe-design, designlang and Dembrandt against the accuracy set (repo checkout only)',
  usage: USAGE,
  async run(args) {
    let values;
    try {
      ({ values } = parseArgs({
        args,
        options: {
          sites: { type: 'string' },
          tools: { type: 'string' },
          from: { type: 'string' },
          out: { type: 'string' },
          spare: { type: 'boolean' },
        },
      }));
    } catch (e) {
      process.stderr.write(`equipe-design eval: ${(e as Error).message}\n\n${USAGE}\n`);
      return 1;
    }
    const harness = new URL('../../../../eval/src/run.ts', import.meta.url);
    if (!existsSync(harness)) {
      process.stderr.write('equipe-design eval: eval/ not found — run this from a checkout of the equipe-design repository.\n');
      return 1;
    }
    const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
    const tools = list(values.tools);
    const known = ['equipe-design', 'designlang', 'dembrandt'];
    const bad = tools?.find((t) => !known.includes(t));
    if (bad) {
      process.stderr.write(`equipe-design eval: unknown tool "${bad}" (${known.join(', ')})\n`);
      return 1;
    }
    if (values.from && !existsSync(values.from)) {
      process.stderr.write(`equipe-design eval: --from ${values.from} does not exist\n`);
      return 1;
    }
    try {
      const { runEval } = (await import(harness.href)) as typeof import('../../../../eval/src/run.ts');
      const r = await runEval({
        from: values.from,
        out: values.out,
        sites: list(values.sites),
        tools: tools as ('equipe-design' | 'designlang' | 'dembrandt')[] | undefined,
        spare: values.spare,
        log: (l) => process.stderr.write(`${l}\n`),
      });
      for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
      process.stdout.write(`${r.markdown}\n`);
      process.stderr.write(`${r.scoreboardPath}\n`);
      return 0;
    } catch (e) {
      process.stderr.write(`equipe-design eval: ${(e as Error).message}\n`);
      return 1;
    }
  },
};
