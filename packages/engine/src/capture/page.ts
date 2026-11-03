import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';

export type StorageState = Exclude<Parameters<Browser['newContext']>[0], undefined>['storageState'] & object;
import { PAGE_TIMEOUT_MS } from '../guard/budget.ts';
import type { PageCheck } from '../guard/session.ts';
import { blockMutatingRequests, type DenyRule, type RouteGuard } from './route.ts';
import { install, type Rgba, type SheetScan, type StateProps, type SweepResult, type VarValue } from './inpage.ts';

type Eqd = {
  sweep(): SweepResult;
  scanSheets(): SheetScan;
  scanText(t: string): SheetScan;
  resolveVars(a: { names: string[]; scopes: Record<string, string[]> }): Record<string, VarValue>;
  countUsage(u: Record<string, string[]>): Record<string, number>;
  applyToggle(kind: string): boolean;
  undoToggle(): void;
  markTargets(paths: string[]): number[];
  readState(i: number): StateProps | null;
  pageCheck(): PageCheck;
  scroll(): Promise<void>;
};

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export function findChrome(): string | null {
  const env = process.env.EQUIPE_DESIGN_CHROME;
  if (env) return existsSync(env) ? env : null;
  return CHROME_PATHS.find((p) => existsSync(p)) ?? null;
}

export class ChromeNotFound extends Error {
  constructor() {
    super('Chrome not found. Install Google Chrome, or set EQUIPE_DESIGN_CHROME to a Chrome/Chromium binary (e.g. after `npx playwright install chromium`).');
  }
}

/** A fresh headless Chrome with an empty, temporary profile. Never an existing browser. */
export async function launchBrowser(): Promise<Browser> {
  const executablePath = findChrome();
  if (!executablePath) throw new ChromeNotFound();
  return chromium.launch({ executablePath, headless: true, args: ['--disable-extensions', '--no-first-run', '--no-default-browser-check'] });
}

const COOKIE_HIDE = [
  '#onetrust-banner-sdk', '#onetrust-consent-sdk', '#CybotCookiebotDialog', '.cc-window', '.cc-banner', '#cookie-banner', '.cookie-banner',
  '#cookieConsent', '.cookie-consent', '#truste-consent-track', '#didomi-host', '#usercentrics-root', '[aria-label*="cookie" i][role="dialog"]',
  '[id*="cookie-banner" i]', '[class*="cookie-banner" i]', '[id*="consent-banner" i]', '[class*="consent-banner" i]',
].join(',');

export interface OpenedPage {
  page: Page;
  context: BrowserContext;
  cdp: CDPSession;
  status: number | null;
  finalUrl: URL | null;
  timedOut: boolean;
  mutatingBlocked(): number;
  /** Stylesheet bodies the page fetched, kept in memory only until scanned. */
  sheetBodies: Map<string, Promise<string>>;
  /** Every request URL the page made (for tests and the guardrail record). */
  requests: string[];
}

export interface ReadingContextOptions {
  width: number;
  userAgent: string;
  /** A signed-in session (Playwright storageState), only for crawl runs the user started with one. */
  storageState?: StorageState;
  /** Extra read-only rules: a reason to abort this request even though it is a GET. */
  deny?: DenyRule;
}

/** A new browser context that only reads: GET/HEAD only, no WebSockets, no service workers, no downloads. */
export async function newReadingContext(browser: Browser, opts: ReadingContextOptions): Promise<{ context: BrowserContext; route: RouteGuard }> {
  const context = await browser.newContext({
    viewport: { width: opts.width, height: 900 },
    userAgent: opts.userAgent,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    acceptDownloads: false,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  const route = await blockMutatingRequests(context, opts.deny);
  return { context, route };
}

export async function openPage(browser: Browser, url: URL, opts: ReadingContextOptions): Promise<OpenedPage> {
  const { context, route } = await newReadingContext(browser, opts);
  try {
    return await openInContext(context, route, url);
  } catch (e) {
    await context.close();
    throw e;
  }
}

/** Opens `url` in a new tab of a reading context. The caller closes the tab (or the context). */
export async function openInContext(context: BrowserContext, route: RouteGuard, url: URL): Promise<OpenedPage> {
  const page = await context.newPage();
  // A confirm()/prompt() is answered "cancel", so a script can't ask its way into an action.
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
  const sheetBodies = new Map<string, Promise<string>>();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('response', (res) => {
    if (res.request().resourceType() === 'stylesheet' && res.ok()) sheetBodies.set(res.url(), res.text().catch(() => ''));
  });
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  let status: number | null = null;
  let finalUrl: URL | null = null;
  let timedOut = false;
  try {
    const res = await page.goto(url.href, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    status = res?.status() ?? null;
    await settle(page, 10_000);
  } catch (e) {
    if (/Timeout/i.test(String(e))) timedOut = true;
    else {
      await page.close().catch(() => undefined);
      throw e;
    }
  }
  try {
    finalUrl = new URL(page.url());
  } catch {
    finalUrl = null;
  }
  const cdp = await context.newCDPSession(page);
  return { page, context, cdp, status, finalUrl, timedOut, mutatingBlocked: route.blocked, sheetBodies, requests };
}

/**
 * Wait until the page has settled: the network is idle, or — for pages that keep fetching
 * (analytics, consent scripts, looping animations) — no element has been added or removed for
 * `quietMs` and the fonts are in. At most `maxMs`.
 */
export async function settle(page: Page, maxMs: number, quietMs = 1000): Promise<void> {
  const quiet = page
    .evaluate(
      ({ quietMs, maxMs }) =>
        new Promise<void>((done) => {
          let last = performance.now();
          const mo = new MutationObserver((records) => {
            if (records.some((r) => r.addedNodes.length || r.removedNodes.length)) last = performance.now();
          });
          mo.observe(document.documentElement, { childList: true, subtree: true });
          const start = performance.now();
          const tick = () => {
            const now = performance.now();
            if ((now - last >= quietMs && document.fonts.status === 'loaded') || now - start >= maxMs) {
              mo.disconnect();
              done();
            } else setTimeout(tick, 100);
          };
          tick();
        }),
      { quietMs, maxMs },
    )
    .catch(() => undefined);
  await Promise.race([page.waitForLoadState('networkidle', { timeout: maxMs }).catch(() => undefined), quiet]);
}

export async function callInPage<K extends keyof Eqd>(page: Page, method: K, arg?: Parameters<Eqd[K]>[0]): Promise<Awaited<ReturnType<Eqd[K]>>> {
  await page.evaluate(install);
  return page.evaluate(
    ([m, a]) => {
      const eqd = (window as unknown as { __eqd: Record<string, (x: unknown) => unknown> }).__eqd;
      return eqd[m as string]!(a);
    },
    [method, arg] as const,
  ) as Promise<Awaited<ReturnType<Eqd[K]>>>;
}

export async function hideCookieBanners(page: Page): Promise<number> {
  const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, COOKIE_HIDE).catch(() => 0);
  if (n) await page.addStyleTag({ content: `${COOKIE_HIDE}{display:none!important}` }).catch(() => undefined);
  return n;
}

export async function pageExtras(page: Page): Promise<{ iframes: number; canvases: number; fonts: { family: string; status: string }[] }> {
  return page.evaluate(() => ({
    iframes: document.querySelectorAll('iframe').length,
    canvases: Array.from(document.querySelectorAll('canvas')).filter((c) => c.getBoundingClientRect().width > 50).length,
    fonts: Array.from(document.fonts).map((f) => ({ family: f.family.replace(/^["']|["']$/g, ''), status: f.status })),
  }));
}

/** Scans readable sheets in the page, and cross-origin ones from the responses in memory. */
export async function scanStylesheets(opened: OpenedPage): Promise<{ scan: SheetScan; crossOriginParsed: number; unreadable: number }> {
  const scan = await callInPage(opened.page, 'scanSheets');
  let crossOriginParsed = 0;
  let unreadable = 0;
  for (const href of scan.unreadable) {
    const body = opened.sheetBodies.get(href);
    const text = body ? await body : '';
    if (!text) {
      unreadable++;
      continue;
    }
    try {
      const sub = await callInPage(opened.page, 'scanText', text);
      crossOriginParsed++;
      scan.declarations.push(...sub.declarations);
      for (const [k, v] of Object.entries(sub.usage)) scan.usage[k] = [...(scan.usage[k] ?? []), ...v].slice(0, 40);
      scan.darkMediaRules += sub.darkMediaRules;
      for (const [k, v] of Object.entries(sub.darkSelectors)) scan.darkSelectors[k] = (scan.darkSelectors[k] ?? 0) + v;
      scan.breakpoints.push(...sub.breakpoints);
      scan.hasClamp ||= sub.hasClamp;
    } catch {
      unreadable++;
    }
  }
  // The text is not needed any more and is never written anywhere.
  opened.sheetBodies.clear();
  scan.unreadable = [];
  return { scan, crossOriginParsed, unreadable };
}

export type StateName = 'hover' | 'focus-visible' | 'active';

/**
 * Forces :hover / :focus-visible / :active on each target through CDP and reads a fixed set
 * of properties back. Transitions are switched off meanwhile so values are final.
 */
export async function forceStates(opened: OpenedPage, paths: string[]): Promise<Record<string, Partial<Record<'default' | StateName, StateProps>>>> {
  const { page, cdp } = opened;
  const out: Record<string, Partial<Record<'default' | StateName, StateProps>>> = {};
  if (!paths.length) return out;
  const style = await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('DOM.getDocument', { depth: 0 });
    const idx = await callInPage(page, 'markTargets', paths);
    for (let i = 0; i < paths.length; i++) {
      const t = idx[i]!;
      if (t < 0) continue;
      const path = paths[i]!;
      const rec: Partial<Record<'default' | StateName, StateProps>> = {};
      const def = await callInPage(page, 'readState', t);
      if (!def) continue;
      rec.default = def;
      const { result } = await cdp.send('Runtime.evaluate', { expression: `window.__eqd && document.documentElement && (${elementAtSource})(${JSON.stringify(path)})` });
      if (!result.objectId) continue;
      const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId });
      const states: [StateName, string[]][] = [
        ['hover', ['hover']],
        ['focus-visible', ['focus', 'focus-visible']],
        ['active', ['hover', 'active']],
      ];
      for (const [name, classes] of states) {
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
        const v = await callInPage(page, 'readState', t);
        if (v) rec[name] = v;
      }
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      out[path] = rec;
    }
  } finally {
    await style.evaluate((n) => (n as Element).remove()).catch(() => undefined);
  }
  return out;
}

const elementAtSource = `function (path) {
  let e = document.documentElement;
  if (!path) return e;
  for (const part of path.split('/')) e = e ? e.children[+part] || null : null;
  return e;
}`;

export const sameColor = (a: Rgba | null, b: Rgba | null) =>
  a === b || (!!a && !!b && Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[2] - b[2]) < 0.5 && Math.abs(a[3] - b[3]) < 0.01);
