import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateExtraction } from '@equipe-design/schema';
import { ChromeNotFound, crawl, crawlCliOptions, CrawlOptionError, extract, SessionError, writeRun } from '@equipe-design/engine';
import type { Command } from '../command.ts';

const CRAWL = crawlCliOptions();

const USAGE = `Usage: equipe-design extract <url...> [--out DIR] [--widths 1440,390] [--modes auto|light|dark|both] [--no-states] [--json]
       equipe-design extract --crawl <start-url> [--session FILE | --cdp URL] [--max-pages N] [--delay MS] [--per-pattern N] [--reveal N] [--out DIR]

  --out DIR      Run folder (default: ./equipe-design/<host>-<time>/)
  --widths       Viewport widths to read, comma separated (default 1440,390)
  --modes        auto (default) reads light and, when the site has one, dark
  --no-states    Don't force :hover / :focus-visible / :active
  --json         Print only the summary as JSON on stdout

Writes extract.json and report.md. Exit code 0 ok, 2 stopped by a guardrail (robots.txt, login, bot check), 1 error.

Crawl: read every screen of one site — sitemap, same-origin links, the app's navigation — and
write crawl.json, crawl.md and screens/NNN/ (styles.json, screenshots at each width and mode,
menus and dialogs it opened). Reading only: GET/HEAD, no forms, nothing that logs out, deletes,
pays, invites or saves (skipped ones are listed). Signing in is yours: pass your own session.
  --crawl          Crawl from the URL instead of reading the given pages
${CRAWL.usage}`;

export const command: Command = {
  name: 'extract',
  summary: 'Read up to 5 pages (or --crawl a whole site, signed in with your session) and write the results',
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
          crawl: { type: 'boolean' },
          ...CRAWL.options,
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
    if (values.crawl) return runCrawl(positionals, values as Record<string, unknown>, { widths, modes, states: !values['no-states'], quiet });
    const usedCrawlFlags = Object.keys(CRAWL.options).filter((k) => (values as Record<string, unknown>)[k] !== undefined);
    if (usedCrawlFlags.length) {
      process.stderr.write(`equipe-design extract: --${usedCrawlFlags[0]} goes with --crawl\n`);
      return 1;
    }
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

async function runCrawl(positionals: string[], values: Record<string, unknown>, o: { widths?: number[]; modes: 'auto' | 'light' | 'dark' | 'both'; states: boolean; quiet: boolean }): Promise<number> {
  let options;
  try {
    options = CRAWL.fromValues(values);
  } catch (e) {
    if (e instanceof CrawlOptionError) {
      process.stderr.write(`equipe-design extract: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  let host = 'site';
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(positionals[0]!) ? positionals[0]! : `https://${positionals[0]}`).host.replace(/[^a-z0-9.-]/gi, '-');
  } catch {
    /* keep 'site' */
  }
  const dir = (values.out as string | undefined) ?? join('equipe-design', `${host}-crawl-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  try {
    const { result, exitCode, crawlPath, reportPath } = await crawl(positionals, {
      ...options,
      outDir: dir,
      ...(o.widths ? { widths: o.widths } : {}),
      modes: o.modes,
      states: o.states,
      log: o.quiet ? undefined : (l) => process.stderr.write(`${l}\n`),
    });
    const summary = { screens: result.screens.length, discovered: result.discovered.total, skipped: result.skippedCounts, stoppedBy: result.run.stoppedBy };
    if (o.quiet) process.stdout.write(JSON.stringify(summary) + '\n');
    else {
      process.stderr.write(
        result.run.stoppedBy && !result.screens.length
          ? `멈춤: ${result.run.stoppedBy} — ${result.run.stopReason}\n`
          : `완료 ${(result.run.durationMs / 1000).toFixed(0)}초 · 화면 ${result.screens.length} · 찾은 주소 ${result.discovered.total} · 건너뜀 ${Object.values(result.skippedCounts).reduce((a, b) => a + (b ?? 0), 0)}${result.run.stoppedBy ? ` · 멈춤: ${result.run.stopReason}` : ''}\n`,
      );
      process.stdout.write(`${crawlPath}\n${reportPath}\n`);
    }
    return exitCode;
  } catch (e) {
    if (e instanceof ChromeNotFound || e instanceof SessionError) process.stderr.write(`equipe-design: ${e.message}\n`);
    else process.stderr.write(`equipe-design extract: ${(e as Error).stack ?? e}\n`);
    return 1;
  }
}
