import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateExtraction } from '@equipe-design/schema';
import { ChromeNotFound, extract, writeRun } from '@equipe-design/engine';
import type { Command } from '../command.ts';

const USAGE = `Usage: equipe-design extract <url...> [--out DIR] [--widths 1440,390] [--modes auto|light|dark|both] [--no-states] [--json]

  --out DIR      Run folder (default: ./equipe-design/<host>-<time>/)
  --widths       Viewport widths to read, comma separated (default 1440,390)
  --modes        auto (default) reads light and, when the site has one, dark
  --no-states    Don't force :hover / :focus-visible / :active
  --json         Print only the summary as JSON on stdout

Writes extract.json and report.md. Exit code 0 ok, 2 stopped by a guardrail (robots.txt, login, bot check), 1 error.`;

export const command: Command = {
  name: 'extract',
  summary: 'Read up to 5 pages and write extract.json + report.md',
  usage: USAGE,
  async run(args) {
    let parsed;
    try {
      parsed = parseArgs({
        args,
        allowPositionals: true,
        options: {
          out: { type: 'string' },
          widths: { type: 'string' },
          modes: { type: 'string' },
          'no-states': { type: 'boolean' },
          json: { type: 'boolean' },
        },
      });
    } catch (e) {
      process.stderr.write(`equipe-design extract: ${(e as Error).message}\n\n${USAGE}\n`);
      return 1;
    }
    const { values, positionals } = parsed;
    if (!positionals.length) {
      process.stderr.write(`${USAGE}\n`);
      return 1;
    }
    const modes = (values.modes ?? 'auto') as 'auto' | 'light' | 'dark' | 'both';
    if (!['auto', 'light', 'dark', 'both'].includes(modes)) {
      process.stderr.write(`equipe-design extract: --modes must be auto, light, dark or both\n`);
      return 1;
    }
    const widths = values.widths ? values.widths.split(',').map((w) => parseInt(w, 10)).filter((w) => w > 0) : undefined;
    const quiet = !!values.json;
    try {
      const { extraction, exitCode } = await extract(positionals, {
        widths,
        modes,
        states: !values['no-states'],
        log: quiet ? undefined : (l) => process.stderr.write(`${l}\n`),
      });
      const host = (() => {
        try {
          return new URL(extraction.source.pages[0]!.url).hostname || 'file';
        } catch {
          return 'site';
        }
      })();
      const dir = values.out ?? join('equipe-design', `${host}-${extraction.run.startedAt.replace(/[:.]/g, '-').slice(0, 19)}`);
      const files = writeRun(extraction, dir);
      const check = validateExtraction(extraction);
      if (!check.ok) {
        process.stderr.write(`warning: result does not pass schema 0.1:\n${check.issues.slice(0, 10).map((i) => `  ${i.kind} ${i.path}: ${i.message}`).join('\n')}\n`);
      }
      if (quiet) process.stdout.write(JSON.stringify(extraction.summary) + '\n');
      else {
        const s = extraction.summary;
        process.stderr.write(
          extraction.run.stoppedBy
            ? `멈춤: ${extraction.run.stoppedBy} — ${extraction.limits[0]?.reason ?? ''}\n`
            : `완료 ${(extraction.run.durationMs / 1000).toFixed(1)}초 · 색 ${s.colors} · 역할 ${s.roles.filled}/${s.roles.filled + s.roles.empty} · 브랜드 ${s.brand} · 다크 쌍 ${s.darkPairs} · 컴포넌트 ${s.components} · 한계 ${s.limits}\n`,
        );
        process.stdout.write(`${files.extractPath}\n${files.reportPath}\n`);
      }
      return check.ok ? exitCode : 1;
    } catch (e) {
      if (e instanceof ChromeNotFound) process.stderr.write(`equipe-design: ${e.message}\n`);
      else process.stderr.write(`equipe-design extract: ${(e as Error).stack ?? e}\n`);
      return 1;
    }
  },
};
