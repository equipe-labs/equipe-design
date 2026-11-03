// Crawl options, defined once: the CLI (`extract --crawl`, kebab-case flags) and the MCP tool
// (`design_extract` with `crawl: true`, camelCase keys) are both built from this table, so the
// two take the same options with the same defaults and checks.

export interface CrawlOptions {
  /** Playwright storageState file of a signed-in session. */
  session?: string;
  /** Address of a browser the user's agent signed in with (http://127.0.0.1:9222). */
  cdp?: string;
  /** Screens to read at most; 0 = no cap. */
  maxPages: number;
  /** Pause between page loads, in milliseconds. */
  delayMs: number;
  /** URLs of the same shape (/project/:id) to read. */
  perPattern: number;
  /** Menus, dialogs, dropdowns and tabs to open on each screen; 0 = none. */
  reveal: number;
}

/**
 * Defaults, and why:
 * - maxPages 60: a screen takes about 8–15 s (2 widths × 2 modes, 4 screenshots, menus; 9 s on
 *   equipe.im, 10.5 s on a local Gitea, 2026-11-04), so 60 is about 10–15 minutes. With `perPattern` 3 that covers the distinct screen templates of a typical
 *   app (dashboard, lists, detail, settings sections); more pages mostly repeat templates.
 * - delayMs 1500: at least 1.5 s between page loads on top of the page's own time, so a crawl
 *   stays well under one page load per 5 s on a site (extract uses 1 s for at most 5 pages).
 * - perPattern 3: three examples of a template show its variants (empty/full lists, states)
 *   without reading every project or issue.
 * - reveal 6: the menus/dialogs found first on a screen (navigation, account, filters).
 */
export const CRAWL_DEFAULTS: CrawlOptions = { maxPages: 60, delayMs: 1500, perPattern: 3, reveal: 6 };
export const MIN_DELAY_MS = 500;

interface Def {
  key: keyof CrawlOptions;
  flag: string;
  type: 'string' | 'integer';
  min?: number;
  help: string;
}

export const CRAWL_OPTION_DEFS: Def[] = [
  { key: 'session', flag: 'session', type: 'string', help: 'Playwright storageState file of a signed-in session (the user’s own account). Only the crawled site’s cookies and storage are used.' },
  { key: 'cdp', flag: 'cdp', type: 'string', help: 'Address of a browser the user’s agent signed in with (e.g. http://127.0.0.1:9222). Its session for the site is copied; the crawl reads in its own browser.' },
  { key: 'maxPages', flag: 'max-pages', type: 'integer', min: 0, help: `Screens to read at most, 0 = no cap (default ${CRAWL_DEFAULTS.maxPages}).` },
  { key: 'delayMs', flag: 'delay', type: 'integer', min: MIN_DELAY_MS, help: `Milliseconds between page loads, at least ${MIN_DELAY_MS} (default ${CRAWL_DEFAULTS.delayMs}).` },
  { key: 'perPattern', flag: 'per-pattern', type: 'integer', min: 1, help: `URLs of one shape (/project/:id) to read (default ${CRAWL_DEFAULTS.perPattern}).` },
  { key: 'reveal', flag: 'reveal', type: 'integer', min: 0, help: `Menus, dialogs and dropdowns to open per screen, 0 = none (default ${CRAWL_DEFAULTS.reveal}).` },
];

export class CrawlOptionError extends Error {}

/** Checks raw values (keys as in CrawlOptions; integers may come as strings from a command line). */
export function crawlOptionsFrom(raw: Partial<Record<keyof CrawlOptions, unknown>>, name: (d: Def) => string = (d) => d.key): CrawlOptions {
  const out: CrawlOptions = { ...CRAWL_DEFAULTS };
  for (const d of CRAWL_OPTION_DEFS) {
    const v = raw[d.key];
    if (v === undefined) continue;
    if (d.type === 'string') {
      if (typeof v !== 'string' || !v.trim()) throw new CrawlOptionError(`"${name(d)}" must be a non-empty string`);
      (out as unknown as Record<string, unknown>)[d.key] = v;
      continue;
    }
    const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < (d.min ?? 0)) throw new CrawlOptionError(`"${name(d)}" must be a whole number ≥ ${d.min ?? 0}`);
    (out as unknown as Record<string, unknown>)[d.key] = n;
  }
  if (out.session && out.cdp) throw new CrawlOptionError(`give "${name(CRAWL_OPTION_DEFS[0]!)}" or "${name(CRAWL_OPTION_DEFS[1]!)}", not both`);
  return out;
}

/** JSON Schema properties for the MCP tool. */
export function crawlSchemaProperties(): Record<string, Record<string, unknown>> {
  const props: Record<string, Record<string, unknown>> = {};
  for (const d of CRAWL_OPTION_DEFS) props[d.key] = d.type === 'string' ? { type: 'string', description: d.help } : { type: 'integer', minimum: d.min ?? 0, description: d.help };
  return props;
}

/** parseArgs options and usage lines for the CLI. */
export function crawlCliOptions(): { options: Record<string, { type: 'string' }>; usage: string; fromValues(v: Record<string, unknown>): CrawlOptions } {
  const options: Record<string, { type: 'string' }> = {};
  for (const d of CRAWL_OPTION_DEFS) options[d.flag] = { type: 'string' };
  const usage = CRAWL_OPTION_DEFS.map((d) => `  --${`${d.flag} ${d.type === 'string' ? (d.key === 'cdp' ? 'URL' : 'FILE') : 'N'}`.padEnd(16)} ${d.help}`).join('\n');
  return {
    options,
    usage,
    fromValues: (v) => crawlOptionsFrom(Object.fromEntries(CRAWL_OPTION_DEFS.map((d) => [d.key, v[d.flag]])), (d) => `--${d.flag}`),
  };
}
