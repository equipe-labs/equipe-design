import { ownBrowserLaunch } from '../browser.ts';
import { ArgError, path, strList } from '../args.ts';
import { getEngine, readExtraction } from '../engine.ts';
import { summaryLine } from '../report.ts';
import type { Tool } from '../tool.ts';
import { rmSync } from 'node:fs';
import { CrawlOptionError, crawlOptionsFrom, crawlSchemaProperties, CRAWL_OPTION_DEFS } from '@equipe-design/engine/crawl-options';

const MODES = ['auto', 'light', 'dark', 'both'] as const;

export const tool: Tool = {
  name: 'design_extract',
  description:
    'Read 1-5 pages with a fresh headless browser (never your shared one) and write extract.json + report.md to outDir. ' +
    'Returns the paths, a one-line summary and the limits (what could not be seen); read the file for values. ' +
    'If a guardrail stops the run (robots.txt, login wall, bot check) the result has `stopped` and no values. ' +
    'With `crawl: true` it reads a whole site from urls[0] instead: sitemap, same-origin links and the app\'s navigation, ' +
    'signed in with the user\'s own session when `session` (a Playwright storageState file) or `cdp` (the address of a browser the user\'s agent signed in with) is given. ' +
    'It writes crawl.json, crawl.md and screens/NNN/ (styles.json, screenshots at each width and mode, menus/dialogs it opened) to outDir. ' +
    'Reading only: GET/HEAD, no forms, never presses or follows anything that logs out, deletes, pays, invites or saves (listed as skipped). ' +
    "Intended use: your own sites and services, learning and inspiration. Signing in is the user's own account and responsibility. Don't reproduce someone else's brand.",
  inputSchema: {
    type: 'object',
    properties: {
      urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5, description: 'Pages of one site, http(s).' },
      outDir: { type: 'string', description: 'Folder for extract.json and report.md, e.g. outputs/T-12 …/extract/<host>/' },
      widths: { type: 'array', items: { type: 'integer', minimum: 320 }, description: 'Viewport widths, default [1440, 390].' },
      modes: { enum: [...MODES], description: 'Colour schemes to read, default auto.' },
      states: { type: 'boolean', description: 'Read hover/focus/disabled states, default true.' },
      crawl: { type: 'boolean', description: 'Crawl the whole site from urls[0] (see the options below) instead of reading 1-5 pages.' },
      ...crawlSchemaProperties(),
    },
    required: ['urls', 'outDir'],
    additionalProperties: false,
  },
  async handler(args) {
    const urls = strList(args, 'urls', 1, 5);
    for (const u of urls) {
      let p: URL;
      try {
        p = new URL(u);
      } catch {
        throw new ArgError(`not a URL: ${u}`);
      }
      if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new ArgError(`only http(s) pages: ${u}`);
    }
    const outDir = path(args, 'outDir');
    const widths = args.widths;
    if (widths !== undefined && (!Array.isArray(widths) || widths.some((w) => !Number.isInteger(w) || (w as number) < 320))) throw new ArgError('"widths" must be whole numbers ≥ 320');
    const modes = args.modes;
    if (modes !== undefined && !MODES.includes(modes as (typeof MODES)[number])) throw new ArgError(`"modes" is one of ${MODES.join(', ')}`);
    if (args.states !== undefined && typeof args.states !== 'boolean') throw new ArgError('"states" must be true or false');

    if (args.crawl !== undefined && typeof args.crawl !== 'boolean') throw new ArgError('"crawl" must be true or false');
    const crawlKeys = CRAWL_OPTION_DEFS.map((d) => d.key).filter((k) => args[k] !== undefined);
    if (!args.crawl && crawlKeys.length) throw new ArgError(`"${crawlKeys[0]}" goes with "crawl": true`);
    let crawl;
    if (args.crawl) {
      try {
        crawl = crawlOptionsFrom(Object.fromEntries(crawlKeys.map((k) => [k, k === 'session' ? path(args, 'session') : args[k]])));
      } catch (e) {
        if (e instanceof CrawlOptionError) throw new ArgError(e.message);
        throw e;
      }
    }

    const engine = await getEngine();
    if (crawl && !engine.crawl) throw new ArgError(`the ${engine.name} engine can't crawl`);
    const browser = ownBrowserLaunch();
    try {
      if (crawl && engine.crawl) {
        const r = await engine.crawl({
          urls, outDir, browser, crawl,
          ...(widths ? { widths: widths as number[] } : {}),
          ...(modes ? { modes: modes as (typeof MODES)[number] } : {}),
          ...(args.states !== undefined ? { states: args.states as boolean } : {}),
        });
        return {
          crawlPath: r.crawlPath,
          reportPath: r.reportPath,
          summary: `screens ${r.screens} · found ${r.discovered} · skipped ${Object.entries(r.skipped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
          ...(r.stoppedBy ? { stopped: r.stoppedBy, stopReason: r.stopReason } : {}),
          engine: engine.name,
        };
      }
      const { extractPath, reportPath } = await engine.extract({
        urls, outDir, browser,
        ...(widths ? { widths: widths as number[] } : {}),
        ...(modes ? { modes: modes as (typeof MODES)[number] } : {}),
        ...(args.states !== undefined ? { states: args.states as boolean } : {}),
      });
      const x = readExtraction(extractPath);
      return {
        extractPath,
        reportPath,
        summary: summaryLine(x, { fake: engine.fake }),
        limits: x.limits.map((l) => ({ kind: l.kind, reason: l.reason })),
        ...(x.run.stoppedBy ? { stopped: x.run.stoppedBy } : {}),
        engine: engine.name,
      };
    } finally {
      rmSync(browser.userDataDir, { recursive: true, force: true });
    }
  },
};
