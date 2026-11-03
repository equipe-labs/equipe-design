// A crawl: start from one page of a site and read every screen it can find — the sitemap,
// links on the same origin, and the app's own navigation (sidebars, tabs) — with the user's
// signed-in session when one is given. Reading only (see rules.ts, reveal.ts, route.ts and
// docs/crawl.md). Each screen gets the engine's input (light/dark computed-style sweeps at each
// width), screenshots at each width and mode, and the menus/dialogs it could open.
//
// Output, one folder per run:
//   crawl.json            what was read, what was skipped and why, what the network guard aborted
//   crawl.md              the same for people
//   screens/NNN/styles.json        PageData: the sweeps the extraction engine reads
//   screens/NNN/<width>-<mode>.jpg full-page screenshots (at most 8000 px tall)
//   screens/NNN/reveal-KK.jpg|.json a menu/dialog opened on that screen, and its sweep

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Mode } from '@equipe-design/schema';
import { callInPage, launchBrowser, newReadingContext, openInContext, type OpenedPage } from '../capture/page.ts';
import type { RouteGuard } from '../capture/route.ts';
import { capturePage, USER_AGENT_TOKEN, userAgentFor, VERSION, type DarkDetect } from '../extract.ts';
import { sleep } from '../guard/budget.ts';
import { RobotsGuard } from '../guard/robots.ts';
import { detectWall } from '../guard/session.ts';
import { CRAWL_DEFAULTS, type CrawlOptions } from './options.ts';
import { reveal } from './reveal.ts';
import { actionInLabel, actionInUrl, AUTH_PATH, normalizeUrl, notAScreen, urlPattern } from './rules.ts';
import { loadSession, type SessionSource, type SessionSummary } from './session.ts';
import { readSitemaps } from './sitemap.ts';

export interface CrawlRunOptions extends Partial<CrawlOptions> {
  outDir: string;
  widths?: number[];
  modes?: 'auto' | 'light' | 'dark' | 'both';
  states?: boolean;
  log?: (line: string) => void;
  /** For tests: a fetch for robots.txt and sitemaps. */
  fetch?: typeof fetch;
}

export type Found = 'start' | 'sitemap' | 'nav' | 'link';

export interface Screen {
  n: number;
  url: string;
  finalUrl: string | null;
  status: number | null;
  title: string;
  pattern: string;
  foundBy: Found;
  dir: string;
  styles: string;
  modes: Mode[];
  shots: { width: number; mode: Mode; path: string }[];
  reveals: { label: string; kind: string; shot: string; styles: string }[];
  links: number;
}

export type SkipKind = 'action-link' | 'action-control' | 'auth-page' | 'not-a-screen' | 'robots' | 'same-pattern' | 'over-cap' | 'off-site' | 'login-wall' | 'bot-challenge' | 'error' | 'duplicate';

export interface Skipped {
  kind: SkipKind;
  url?: string;
  label?: string;
  on?: string;
  reason: string;
}

export interface CrawlResult {
  tool: { name: 'equipe-design'; version: string; chrome: string | null };
  run: {
    startedAt: string;
    durationMs: number;
    userAgent: string;
    site: string;
    options: CrawlOptions & { widths: number[]; modes: string; states: boolean; session?: undefined; cdp?: undefined };
    stoppedBy: 'login-required' | 'robots-disallowed' | 'bot-challenge' | null;
    stopReason: string | null;
  };
  session: SessionSummary;
  discovered: { total: number; sitemap: number; sitemapFiles: string[]; sitemapFailed: { url: string; reason: string }[]; nav: number; links: number; offSiteLinks: number };
  guardrails: {
    methods: 'GET/HEAD only';
    nonGetBlocked: number;
    actionGetsBlocked: number;
    navigationsBlockedWhileRevealing: number;
    webSocketsBlocked: number;
    formsSubmitted: 0;
    keystrokes: 0;
    clicks: number;
    dialogsDismissed: true;
  };
  screens: Screen[];
  skipped: Skipped[];
  skippedCounts: Partial<Record<SkipKind, number>>;
  blocked: { url: string; method: string; reason: string }[];
}

const MAX_SKIPPED = 2000;
const SHOT_MAX_HEIGHT = 8000;

interface QueueItem {
  url: URL;
  foundBy: Found;
  /** Set once it was put back behind new screens (another example of a shape, or a filter of a page already read). */
  deferred?: boolean;
}

export async function crawl(starts: string[], opts: CrawlRunOptions): Promise<{ result: CrawlResult; exitCode: 0 | 2; crawlPath: string; reportPath: string }> {
  const started = new Date();
  const t0 = performance.now();
  const log = opts.log ?? (() => undefined);
  const o: CrawlOptions = { ...CRAWL_DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) } as CrawlOptions;
  const widths = (opts.widths?.length ? opts.widths : [1440, 390]).slice(0, 3);
  const modesOpt = opts.modes ?? 'auto';
  const statesEnabled = opts.states !== false;
  const seeds = starts.map((s) => normalizeUrl(new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)));
  if (!seeds.length) throw new Error('no start URL');
  const site = seeds[0]!;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') throw new Error(`only http(s) sites can be crawled: ${site.href}`);
  mkdirSync(opts.outDir, { recursive: true });

  const sessionSource: SessionSource = o.session ? { kind: 'storage-state', path: o.session } : o.cdp ? { kind: 'cdp', endpoint: o.cdp } : { kind: 'none' };
  const session = await loadSession(sessionSource, site);
  if (session.summary.source !== 'none') log(`세션: ${session.summary.source}, 이 사이트 쿠키 ${session.summary.cookies}개(다른 사이트 ${session.summary.droppedCookies}개는 버림)`);

  const robots = new RobotsGuard(USER_AGENT_TOKEN, opts.fetch);
  await robots.check(site);
  const sm = await readSitemaps(site, await robots.sitemaps(site), { userAgent: USER_AGENT_TOKEN, fetch: opts.fetch });
  log(`사이트맵 ${sm.files.length}개 파일, 주소 ${sm.urls.length}개`);

  const skipped: Skipped[] = [];
  const skippedCounts: CrawlResult['skippedCounts'] = {};
  const skippedKeys = new Set<string>();
  const skip = (s: Skipped) => {
    const key = `${s.kind}|${s.url ?? ''}|${s.label ?? ''}`;
    if (skippedKeys.has(key)) return;
    skippedKeys.add(key);
    skippedCounts[s.kind] = (skippedCounts[s.kind] ?? 0) + 1;
    if (skipped.length < MAX_SKIPPED) skipped.push(s);
  };

  // Three lanes: the app's navigation first, then the sitemap, then other links.
  const lanes: Record<'nav' | 'sitemap' | 'link', QueueItem[]> = { nav: [], sitemap: [], link: [] };
  const known = new Set<string>();
  const banned = new Set<string>();
  const discovered = { total: 0, sitemap: 0, sitemapFiles: sm.files, sitemapFailed: sm.failed, nav: 0, links: 0, offSiteLinks: 0 };
  const consider = (raw: string, foundBy: Found, ctx: { label?: string; on?: string; wired?: string | null } = {}): void => {
    let u: URL;
    try {
      u = normalizeUrl(new URL(raw, ctx.on ?? site));
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    if (u.origin !== site.origin) {
      if (foundBy === 'sitemap') skip({ kind: 'off-site', url: u.href, reason: '다른 출처(사이트맵)' });
      else discovered.offSiteLinks++;
      return;
    }
    const label = ctx.label?.slice(0, 80);
    const base = { url: u.href, ...(label ? { label } : {}), ...(ctx.on ? { on: ctx.on } : {}) };
    // A link a script turns into a request (data-method=delete…): that link is skipped, but its
    // address opened with GET is only a page, so another plain link to it may still be read.
    if (ctx.wired) return skip({ kind: 'action-link', ...base, reason: `링크가 요청에 연결됨(${ctx.wired})` });
    // A link named like an action ("Log out" → /bye): opening its address *is* the action, so the
    // address is never opened, whichever link leads to it.
    const named = label ? actionInLabel(label, 'link') : null;
    if (named && !banned.has(u.href)) {
      banned.add(u.href);
      return skip({ kind: 'action-link', ...base, reason: `바꾸는 동작으로 보임(${named})` });
    }
    if (known.has(u.href)) return;
    known.add(u.href);
    discovered.total++;
    if (foundBy === 'nav') discovered.nav++;
    else if (foundBy === 'link') discovered.links++;
    const action = actionInUrl(u);
    if (action) return skip({ kind: 'action-link', ...base, reason: `바꾸는 동작으로 보임(${action})` });
    if (AUTH_PATH.test(u.pathname)) return skip({ kind: 'auth-page', ...base, reason: '로그인·가입·비밀번호 화면(세션을 끝내거나 새로 만들 수 있음)' });
    const file = notAScreen(u);
    if (file) return skip({ kind: 'not-a-screen', ...base, reason: file });
    if (foundBy === 'start') lanes.nav.unshift({ url: u, foundBy });
    else lanes[foundBy === 'sitemap' ? 'sitemap' : foundBy].push({ url: u, foundBy });
  };
  for (const s of seeds) {
    if (s.origin !== site.origin) skip({ kind: 'off-site', url: s.href, reason: '첫 주소와 출처가 다름' });
    else consider(s.href, 'start');
  }
  for (const u of sm.urls) consider(u, 'sitemap');
  const sitemapSame = new Set<string>();
  for (const u of sm.urls) {
    try {
      const n = normalizeUrl(new URL(u, site));
      if (n.origin === site.origin) sitemapSame.add(n.href);
    } catch {
      /* not a URL */
    }
  }
  discovered.sitemap = sitemapSame.size;

  const screens: Screen[] = [];
  const perPattern = new Map<string, number>();
  const visitedFinal = new Set<string>();
  let stoppedBy: CrawlResult['run']['stoppedBy'] = null;
  let stopReason: string | null = null;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let route: RouteGuard | null = null;
  let chrome: string | null = null;
  let clicks = 0;
  let wallsInARow = 0;
  let navBlockedWhileRevealing = 0;
  const nav = { blocked: false };
  // New shapes first: another example of a shape already read, or the same path with other
  // parameters (filter tabs, sorting, paging), waits until every new screen found so far is read.
  const repeats: QueueItem[] = [];
  const pathsRead = new Set<string>();
  const next = (): QueueItem | undefined => lanes.nav.shift() ?? lanes.sitemap.shift() ?? lanes.link.shift() ?? repeats.shift();
  const cap = o.maxPages > 0 ? o.maxPages : Infinity;

  try {
    browser = await launchBrowser();
    chrome = browser.version();
    const userAgent = await userAgentFor(browser);
    const made = await newReadingContext(browser, {
      width: Math.max(...widths),
      userAgent,
      ...(session.state ? { storageState: session.state } : {}),
      deny: (req) => {
        if (nav.blocked && req.isNavigation && req.resourceType === 'document') {
          navBlockedWhileRevealing++;
          return '메뉴를 여는 중 페이지 이동';
        }
        if (!['document', 'xhr', 'fetch', 'eventsource'].includes(req.resourceType)) return null;
        let u: URL;
        try {
          u = new URL(req.url);
        } catch {
          return null;
        }
        if (u.origin !== site.origin) return null;
        const action = actionInUrl(u);
        if (action) return `바꾸는 동작으로 보이는 GET(${action})`;
        if (banned.has(normalizeUrl(u).href)) return '바꾸는 동작 이름의 링크가 가리키는 주소';
        if (req.isNavigation && AUTH_PATH.test(u.pathname) && session.state) return '로그인·로그아웃 화면으로 이동';
        return null;
      },
    });
    context = made.context;
    route = made.route;

    let first = true;
    for (let item = next(); item; item = next()) {
      if (screens.length >= cap) {
        skip({ kind: 'over-cap', url: item.url.href, reason: `페이지 상한 ${o.maxPages}개에 닿음` });
        continue;
      }
      if (banned.has(item.url.href)) continue;
      const pattern = urlPattern(item.url);
      const n = perPattern.get(pattern) ?? 0;
      if (!item.deferred && (n > 0 || pathsRead.has(item.url.pathname))) {
        item.deferred = true;
        repeats.push(item);
        continue;
      }
      if (n >= o.perPattern) {
        skip({ kind: 'same-pattern', url: item.url.href, reason: `같은 꼴(${pattern}) ${o.perPattern}개를 이미 읽음` });
        continue;
      }
      const rd = await robots.check(item.url);
      if (!rd.allowed) {
        skip({ kind: 'robots', url: item.url.href, reason: rd.rule ? `robots.txt '${rd.rule}'` : (rd.note ?? 'robots.txt가 막음') });
        if (first && item.foundBy === 'start') {
          stoppedBy = 'robots-disallowed';
          stopReason = `첫 주소를 robots.txt가 막음`;
          break;
        }
        continue;
      }
      if (!first) await sleep(o.delayMs);
      log(`읽는 중 [${screens.length + 1}${cap === Infinity ? '' : `/${cap}`}] ${item.url.href}`);
      let opened: OpenedPage | null = null;
      try {
        opened = await openInContext(context, route, item.url);
      } catch (e) {
        skip({ kind: 'error', url: item.url.href, reason: String((e as Error).message).split('\n')[0]!.slice(0, 120) });
        continue;
      }
      const page = opened.page;
      try {
        const check = await callInPage(page, 'pageCheck');
        let wall = detectWall({ status: opened.status, requestedUrl: item.url, finalUrl: opened.finalUrl, check });
        // Signed in, a page that answered 200 at its own address with a password field is a
        // settings form ("change password"), not the login screen.
        if (wall.wall === 'login-required' && session.state && !first && opened.status !== null && opened.status < 400 && opened.finalUrl?.pathname === item.url.pathname) {
          wall = { wall: null, reason: null };
        }
        if (wall.wall) {
          skip({ kind: wall.wall === 'bot-challenge' ? 'bot-challenge' : 'login-wall', url: item.url.href, reason: `${wall.reason} — 우회하지 않음` });
          wallsInARow++;
          if (wall.wall === 'bot-challenge' || first || wallsInARow >= 3) {
            stoppedBy = wall.wall === 'bot-challenge' ? 'bot-challenge' : 'login-required';
            stopReason =
              wall.wall === 'bot-challenge'
                ? '봇 확인 화면이 나옴 — 멈춤'
                : first
                  ? session.state
                    ? '첫 화면이 로그인을 요구함 — 세션이 없거나 끝났음'
                    : '첫 화면이 로그인을 요구함 — --session 또는 --cdp로 로그인 상태를 주기'
                  : '로그인 화면이 3번 이어짐 — 세션이 끝난 것으로 보고 멈춤';
            break;
          }
          continue;
        }
        wallsInARow = 0;
        const final = opened.finalUrl ? normalizeUrl(opened.finalUrl) : item.url;
        if (final.origin !== site.origin) {
          skip({ kind: 'off-site', url: item.url.href, reason: `다른 출처로 리다이렉트됨(${final.origin})` });
          continue;
        }
        if (visitedFinal.has(final.href)) {
          skip({ kind: 'duplicate', url: item.url.href, reason: `이미 읽은 화면으로 리다이렉트됨(${final.href})` });
          continue;
        }
        visitedFinal.add(final.href);
        known.add(final.href);
        perPattern.set(pattern, n + 1);
        pathsRead.add(final.pathname);
        pathsRead.add(item.url.pathname);
        first = false;

        const num = screens.length + 1;
        const rel = join('screens', String(num).padStart(3, '0'));
        const dir = join(opts.outDir, rel);
        mkdirSync(dir, { recursive: true });
        const shots: Screen['shots'] = [];
        const dark: DarkDetect = { method: null, mediaRules: 0, toggles: [], toggled: null, mediaVariables: 0, defaultDark: false };
        const data = await capturePage(opened, 0, widths, modesOpt, statesEnabled, dark, log, {
          onSweep: async (mode, width) => {
            const file = `${width}-${mode}.jpg`;
            await fullShot(page, width, join(dir, file));
            shots.push({ width, mode, path: join(rel, file) });
          },
        });
        data.page.index = num - 1;
        // A dark page with no light mode is relabelled after the first sweep.
        const modes = [...new Set(data.page.sweeps.map((s) => s.mode))];
        if (!modes.includes('light')) for (const s of shots) s.mode = 'dark';
        writeFileSync(join(dir, 'styles.json'), JSON.stringify(data.page) + '\n');

        // Menus, dialogs, dropdowns, tabs.
        const reveals: Screen['reveals'] = [];
        if (o.reveal > 0) {
          const r = await reveal(page, {
            max: o.reveal,
            setNavigationBlocked: (on) => (nav.blocked = on),
            reload: async () => {
              await page.goto(final.href, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
              await sleep(300);
            },
          });
          clicks += r.clicks;
          for (const [k, rv] of r.revealed.entries()) {
            const base = `reveal-${String(k + 1).padStart(2, '0')}`;
            writeFileSync(join(dir, `${base}.jpg`), rv.shot);
            writeFileSync(join(dir, `${base}.json`), JSON.stringify({ label: rv.label, kind: rv.kind, mode: data.page.sweeps[0]!.mode, width: Math.max(...widths), result: rv.sweep }) + '\n');
            reveals.push({ label: rv.label, kind: rv.kind, shot: join(rel, `${base}.jpg`), styles: join(rel, `${base}.json`) });
          }
          for (const s of r.skipped) skip({ kind: 'action-control', label: s.label, on: final.href, reason: s.reason });
        }

        // Links and navigation.
        const links = await page.evaluate(collectLinks).catch(() => [] as LinkInfo[]);
        for (const l of links) consider(l.href, l.nav ? 'nav' : 'link', { label: l.label, on: final.href, wired: l.wired });
        const title = (await page.title().catch(() => '')).trim().slice(0, 200);
        screens.push({
          n: num,
          url: item.url.href,
          finalUrl: final.href === item.url.href ? null : final.href,
          status: opened.status,
          title,
          pattern,
          foundBy: item.foundBy,
          dir: rel,
          styles: join(rel, 'styles.json'),
          modes,
          shots,
          reveals,
          links: links.length,
        });
        log(`  ${title || '(제목 없음)'} · 스크린샷 ${shots.length} · 열어 본 UI ${reveals.length} · 링크 ${links.length}`);
      } catch (e) {
        skip({ kind: 'error', url: item.url.href, reason: String((e as Error).message).split('\n')[0]!.slice(0, 120) });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  const blocked = route?.log ?? [];
  const result: CrawlResult = {
    tool: { name: 'equipe-design', version: VERSION, chrome },
    run: {
      startedAt: started.toISOString(),
      durationMs: Math.round(performance.now() - t0),
      userAgent: USER_AGENT_TOKEN,
      site: site.origin,
      options: { maxPages: o.maxPages, delayMs: o.delayMs, perPattern: o.perPattern, reveal: o.reveal, widths, modes: modesOpt, states: statesEnabled },
      stoppedBy,
      stopReason,
    },
    session: session.summary,
    discovered,
    guardrails: {
      methods: 'GET/HEAD only',
      nonGetBlocked: blocked.filter((b) => b.method !== 'GET' && b.method !== 'HEAD').length,
      actionGetsBlocked: blocked.filter((b) => (b.method === 'GET' || b.method === 'HEAD') && !b.reason.startsWith('메뉴를 여는 중')).length,
      navigationsBlockedWhileRevealing: navBlockedWhileRevealing,
      webSocketsBlocked: route?.sockets() ?? 0,
      formsSubmitted: 0,
      keystrokes: 0,
      clicks,
      dialogsDismissed: true,
    },
    screens,
    skipped,
    skippedCounts,
    blocked,
  };
  const crawlPath = join(opts.outDir, 'crawl.json');
  const reportPath = join(opts.outDir, 'crawl.md');
  writeFileSync(crawlPath, JSON.stringify(result, null, 2) + '\n');
  writeFileSync(reportPath, crawlReport(result));
  return { result, exitCode: stoppedBy && !screens.length ? 2 : 0, crawlPath, reportPath };
}

async function fullShot(page: Page, width: number, path: string): Promise<void> {
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, window.innerHeight)).catch(() => 900);
  await page.screenshot({ path, type: 'jpeg', quality: 75, fullPage: true, animations: 'disabled', caret: 'hide', clip: { x: 0, y: 0, width, height: Math.min(height, SHOT_MAX_HEIGHT) } });
}

interface LinkInfo {
  href: string;
  label: string;
  nav: boolean;
  wired: string | null;
}

/** Every link on the page: its address, its name, whether it sits in navigation, and whether a script turns it into a request. */
function collectLinks(): LinkInfo[] {
  const out: LinkInfo[] = [];
  const navSel = 'nav, aside, header, [role="navigation"], [role="tablist"], [role="menubar"], [role="menu"], [class*="sidebar" i], [class*="sidenav" i], [class*="navbar" i], [class*="tabs" i], [class*="menu" i]';
  for (const a of Array.from(document.querySelectorAll('a[href], area[href]'))) {
    const href = (a as HTMLAnchorElement).href;
    if (!href) continue;
    const label = (a.getAttribute('aria-label') || a.textContent || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const method = a.getAttribute('data-method') || a.getAttribute('data-turbo-method');
    const wired = method && !/^get$/i.test(method)
      ? `data-method=${method}`
      : Array.from(a.attributes).map((x) => x.name).find((n) => /^(hx-(post|put|patch|delete)|data-confirm|data-turbo-confirm|data-remote|ping)$/.test(n)) ?? null;
    out.push({ href, label, nav: !!a.closest(navSel), wired });
  }
  return out;
}

export function crawlReport(r: CrawlResult): string {
  const lines: string[] = [];
  lines.push(`# 크롤 ${r.run.site}`, '');
  lines.push(`- 시작 ${r.run.startedAt} · ${(r.run.durationMs / 1000).toFixed(0)}초 · equipe-design ${r.tool.version}`);
  lines.push(`- 세션: ${r.session.source === 'none' ? '없음(공개 화면만)' : `${r.session.source}, 이 사이트 쿠키 ${r.session.cookies}개(다른 사이트 쿠키 ${r.session.droppedCookies}개는 버림)`}`);
  lines.push(`- 옵션: 상한 ${r.run.options.maxPages || '없음'} · 간격 ${r.run.options.delayMs}ms · 같은 꼴 ${r.run.options.perPattern}개 · 열어 볼 UI ${r.run.options.reveal}개 · 폭 ${r.run.options.widths.join(', ')}`);
  lines.push(`- 찾은 주소 ${r.discovered.total}개(사이트맵 ${r.discovered.sitemap} · 내비게이션 ${r.discovered.nav} · 링크 ${r.discovered.links}) · 읽은 화면 ${r.screens.length}개`);
  if (r.run.stoppedBy) lines.push(`- **멈춤: ${r.run.stoppedBy}** — ${r.run.stopReason}`);
  const g = r.guardrails;
  lines.push(`- 읽기 전용: GET/HEAD만. 막은 요청 ${g.nonGetBlocked}건(POST 등) · 바꾸는 GET ${g.actionGetsBlocked}건 · 메뉴 열다 막은 이동 ${g.navigationsBlockedWhileRevealing}건 · WebSocket ${g.webSocketsBlocked}건 · 폼 제출 0 · 입력 0 · 누른 것 ${g.clicks}번(열기용 컨트롤만)`, '');
  lines.push('## 화면', '', '| # | 제목 | 주소 | 꼴 | 찾은 곳 | 스크린샷 | 열어 본 UI |', '|---|---|---|---|---|---|---|');
  for (const s of r.screens) {
    lines.push(`| ${s.n} | ${esc(s.title)} | ${esc(s.finalUrl ?? s.url)} | \`${esc(s.pattern)}\` | ${s.foundBy} | ${s.shots.length} | ${s.reveals.map((x) => esc(x.label)).join(', ')} |`);
  }
  lines.push('', '## 건너뛴 것', '');
  const names: Record<SkipKind, string> = {
    'action-link': '바꾸는 동작으로 보이는 링크',
    'action-control': '누르지 않은 버튼·컨트롤',
    'auth-page': '로그인·가입 화면',
    'not-a-screen': '파일·피드',
    robots: 'robots.txt가 막음',
    'same-pattern': '같은 꼴',
    'over-cap': '상한 넘음',
    'off-site': '다른 출처',
    'login-wall': '로그인 벽',
    'bot-challenge': '봇 확인',
    error: '오류',
    duplicate: '중복',
  };
  for (const [kind, count] of Object.entries(r.skippedCounts) as [SkipKind, number][]) {
    lines.push(`### ${names[kind]} (${count})`, '');
    for (const s of r.skipped.filter((x) => x.kind === kind).slice(0, kind === 'same-pattern' || kind === 'over-cap' ? 20 : 200)) {
      lines.push(`- ${s.label ? `「${esc(s.label)}」 ` : ''}${s.url ? esc(s.url) : ''}${s.on && !s.url ? ` (${esc(s.on)})` : ''} — ${esc(s.reason)}`);
    }
    lines.push('');
  }
  if (r.blocked.length) {
    lines.push('## 네트워크에서 막은 요청', '');
    for (const b of r.blocked.slice(0, 100)) lines.push(`- ${b.method} ${esc(b.url)} — ${esc(b.reason)}`);
    lines.push('');
  }
  lines.push('이 폴더에는 로그인한 계정의 화면(스크린샷)이 들어 있어요. 계정 주인만 보는 곳에 두세요. 세션(쿠키·토큰)은 저장하지 않았어요.', '');
  return lines.join('\n');
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
