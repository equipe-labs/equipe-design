import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { actionInLabel, actionInUrl, crawl, crawlCliOptions, crawlOptionsFrom, findChrome, normalizeUrl, scopeSession, urlPattern } from '../src/index.ts';
import { revealRefusal } from '../src/crawl/reveal.ts';
import { sessionFromCdp } from '../src/crawl/session.ts';
import { sleep } from '../src/guard/budget.ts';
import { parseSitemap } from '../src/crawl/sitemap.ts';
import { CRAWL_DEFAULTS, crawlSchemaProperties } from '../src/crawl/options.ts';
import { startCrawlSite, type CrawlSite } from './fixtures/crawl-site.ts';

const hasChrome = findChrome() !== null;

describe('crawl rules', () => {
  it('knows links that act by their address', () => {
    for (const u of ['/logout', '/user/sign-out', '/account/delete', '/billing', '/team/invite', '/x?action=delete', '/x?_method=DELETE', '/repo/archive/main.zip', '/로그아웃']) {
      expect(actionInUrl(new URL(u, 'https://a.test')), u).not.toBeNull();
    }
    for (const u of ['/', '/projects/12', '/settings', '/issues?state=closed', '/repo/issues/new', '/user/settings/applications', '/repo/watchers', '/notifications/subscriptions']) {
      expect(actionInUrl(new URL(u, 'https://a.test')), u).toBeNull();
    }
  });

  it('knows controls that act by their name, in several languages', () => {
    for (const l of ['Log out', 'Sign out', 'Delete workspace', 'Save changes', 'Invite people', 'Pay now', '설정 저장', '로그아웃', '삭제', 'ログアウト', 'Speichern']) {
      expect(actionInLabel(l, 'control'), l).not.toBeNull();
    }
    for (const l of ['Account', 'Projects', 'More options', 'Language', 'Filter', '프로필']) expect(actionInLabel(l, 'control'), l).toBeNull();
    // Links are opened by address: "New issue" is a page to look at, "Log out" is not.
    expect(actionInLabel('New issue', 'link')).toBeNull();
    expect(actionInLabel('Log out', 'link')).not.toBeNull();
  });

  it('never presses submit buttons, navigating links or wired controls', () => {
    const ok = { label: 'Account', href: null, inForm: false, type: 'button', wired: [], tag: 'button' };
    expect(revealRefusal(ok)).toBeNull();
    expect(revealRefusal({ ...ok, type: 'submit', inForm: true })).toBe('폼 제출 버튼');
    expect(revealRefusal({ ...ok, tag: 'a', type: null, href: '/elsewhere' })).toContain('이동');
    expect(revealRefusal({ ...ok, tag: 'a', type: null, href: '#' })).toBeNull();
    expect(revealRefusal({ ...ok, wired: ['hx-post'] })).toContain('hx-post');
    expect(revealRefusal({ ...ok, label: 'Delete project' })).toContain('delete');
  });

  it('gives URLs of one shape one pattern', () => {
    const p = (u: string) => urlPattern(new URL(u, 'https://a.test'));
    expect(p('/project/123')).toBe(p('/project/456'));
    expect(p('/project/123')).toBe('/project/:id');
    expect(p('/o/9b2e1c3a-1111-4222-8333-444455556666/runs/a1b2c3d4e5f6')).toBe('/o/:id/runs/:id');
    expect(p('/issues?state=open&page=2')).toBe(p('/issues?page=9&state=closed'));
    expect(p('/de/')).not.toBe(p('/es/'));
    expect(p('/docs/getting-started')).toBe('/docs/getting-started');
    expect(normalizeUrl(new URL('https://a.test/x?utm_source=y&b=2&a=1#top')).href).toBe('https://a.test/x?a=1&b=2');
  });

  it('keeps only the crawled site in a session', () => {
    const state = {
      cookies: [
        { name: 's', value: 'v', domain: 'app.example.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' },
        { name: 'p', value: 'v', domain: '.example.com', path: '/', expires: -1, httpOnly: false, secure: true, sameSite: 'Lax' },
        { name: 'g', value: 'v', domain: '.google.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'None' },
      ],
      origins: [{ origin: 'https://app.example.com', localStorage: [{ name: 't', value: 'x' }] }, { origin: 'https://mail.google.com', localStorage: [] }],
    };
    const { state: kept, summary } = scopeSession(state, new URL('https://app.example.com/home'));
    expect(kept.cookies?.map((c) => c.name)).toEqual(['s', 'p']);
    expect(kept.origins?.map((o) => o.origin)).toEqual(['https://app.example.com']);
    expect(summary).toEqual({ cookies: 2, droppedCookies: 1, localStorageOrigins: 1 });
    expect(() => scopeSession({ cookies: 'x' }, new URL('https://a.test'))).toThrow(/storageState/);
  });

  it('reads sitemaps and sitemap indexes', () => {
    expect(parseSitemap('<urlset><url><loc>https://a.test/</loc></url><url><loc> https://a.test/b?x=1&amp;y=2 </loc></url></urlset>').urls).toEqual(['https://a.test/', 'https://a.test/b?x=1&y=2']);
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s-0.xml</loc></sitemap></sitemapindex>').sitemaps).toEqual(['https://a.test/s-0.xml']);
  });

  it('CLI flags and MCP keys are one table with the same checks', () => {
    expect(crawlOptionsFrom({})).toEqual(CRAWL_DEFAULTS);
    expect(crawlOptionsFrom({ maxPages: 0, delayMs: 800 })).toMatchObject({ maxPages: 0, delayMs: 800 });
    expect(() => crawlOptionsFrom({ delayMs: 10 })).toThrow(/delayMs/);
    expect(() => crawlOptionsFrom({ session: 'a.json', cdp: 'http://127.0.0.1:9222' })).toThrow(/not both/);
    const cli = crawlCliOptions();
    expect(cli.fromValues({ 'max-pages': '0', delay: '800' })).toEqual(crawlOptionsFrom({ maxPages: 0, delayMs: 800 }));
    expect(() => cli.fromValues({ delay: '10' })).toThrow(/--delay/);
    expect(Object.keys(crawlSchemaProperties()).sort()).toEqual(['cdp', 'delayMs', 'maxPages', 'perPattern', 'reveal', 'session']);
    expect(Object.keys(cli.options).sort()).toEqual(['cdp', 'delay', 'max-pages', 'per-pattern', 'reveal', 'session']);
  });
});

describe.skipIf(!hasChrome)('crawl in the browser', () => {
  let site: CrawlSite | null = null;
  let dir = '';
  afterEach(async () => {
    await site?.close();
    site = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const session = (url: string) => {
    const file = join(dir, 'state.json');
    const host = new URL(url).hostname;
    writeFileSync(file, JSON.stringify({ cookies: [{ name: 'sid', value: 'ok', domain: host, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }, { name: 'other', value: 'x', domain: '.elsewhere.test', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' }], origins: [] }));
    return file;
  };

  it('reads the signed-in screens and changes nothing: no POST, no action link, no socket', async () => {
    site = await startCrawlSite();
    dir = mkdtempSync(join(tmpdir(), 'eqd-crawl-'));
    const out = join(dir, 'run');
    const { result: r, exitCode } = await crawl([`${site.url}/`], { outDir: out, session: session(site.url), widths: [1000, 390], states: false, delayMs: 500, perPattern: 2 });
    expect(exitCode).toBe(0);
    expect(r.session).toMatchObject({ source: 'storage-state', cookies: 1, droppedCookies: 1 });

    // Nothing but GET reached the server, and none of the addresses that act.
    expect(site.requests.filter((q) => q.method !== 'GET' && q.method !== 'HEAD')).toEqual([]);
    const hit = site.requests.map((q) => q.path);
    for (const p of ['/logout', '/bye', '/account/delete', '/billing', '/team/invite', '/api/delete', '/api/delete-project', '/ws', '/search', '/login']) {
      expect(hit.some((h) => h.split('?')[0] === p), p).toBe(false);
    }
    expect(hit.some((h) => h.includes('action=delete'))).toBe(false);
    expect(r.guardrails.nonGetBlocked).toBeGreaterThan(0); // the pages' own POST/beacon
    expect(r.guardrails.webSocketsBlocked).toBeGreaterThan(0);

    // The skipped list names what was left alone.
    const skippedLinks = r.skipped.filter((s) => s.kind === 'action-link').map((s) => `${s.label ?? ''} ${s.url}`);
    for (const want of ['Log out', '로그아웃', 'Delete account', 'Billing', 'Invite people', 'Remove project 1', 'action=delete']) {
      expect(skippedLinks.some((s) => s.includes(want)), want).toBe(true);
    }
    const controls = r.skipped.filter((s) => s.kind === 'action-control').map((s) => `${s.label} — ${s.reason}`);
    expect(controls.some((s) => s.startsWith('Delete project'))).toBe(true);
    expect(r.skipped.some((s) => s.kind === 'not-a-screen' && s.url?.endsWith('/files/report.pdf'))).toBe(true);

    // Screens: sidebar + sitemap pages, one shape read at most perPattern times.
    const paths = r.screens.map((s) => new URL(s.url).pathname);
    for (const p of ['/', '/projects', '/settings', '/docs', '/profile']) expect(paths, p).toContain(p);
    expect(paths.filter((p) => p.startsWith('/projects/')).length).toBe(2);
    expect(r.skipped.some((s) => s.kind === 'same-pattern')).toBe(true);
    expect(r.discovered.sitemap).toBe(3);

    // Each screen: styles (engine input), screenshots per width and mode; the menu was opened.
    const home = r.screens.find((s) => new URL(s.url).pathname === '/')!;
    expect(home.title).toBe('Dashboard');
    expect(home.shots.map((s) => `${s.width}-${s.mode}`).sort()).toEqual(['1000-dark', '1000-light', '390-dark', '390-light']);
    for (const s of home.shots) expect(existsSync(join(out, s.path))).toBe(true);
    const styles = JSON.parse(readFileSync(join(out, home.styles), 'utf8'));
    expect(styles.sweeps.map((s: { mode: string; width: number }) => `${s.width}-${s.mode}`).sort()).toEqual(['1000-dark', '1000-light', '390-dark', '390-light']);
    expect(home.reveals.map((x) => x.label)).toContain('Account');
    expect(existsSync(join(out, home.reveals[0]!.shot))).toBe(true);

    // No session value is written anywhere in the result.
    const written = readFileSync(join(out, 'crawl.json'), 'utf8') + readFileSync(join(out, 'crawl.md'), 'utf8');
    expect(written).not.toMatch(/sid|"ok"/);
  }, 180_000);

  it('stops with exit code 2 when the first screen wants a login and no session was given', async () => {
    site = await startCrawlSite();
    dir = mkdtempSync(join(tmpdir(), 'eqd-crawl-'));
    const { result: r, exitCode } = await crawl([`${site.url}/`], { outDir: join(dir, 'run'), widths: [800], states: false, reveal: 0, delayMs: 500 });
    expect(exitCode).toBe(2);
    expect(r.run.stoppedBy).toBe('login-required');
    expect(r.screens).toEqual([]);
    expect(site.requests.filter((q) => q.method !== 'GET' && q.method !== 'HEAD')).toEqual([]);
  }, 60_000);

  it('stops at the page cap and lists the rest', async () => {
    site = await startCrawlSite();
    dir = mkdtempSync(join(tmpdir(), 'eqd-crawl-'));
    const { result: r } = await crawl([`${site.url}/`], { outDir: join(dir, 'run'), session: session(site.url), widths: [800], modes: 'light', states: false, reveal: 0, delayMs: 500, maxPages: 2 });
    expect(r.screens.length).toBe(2);
    expect(r.skippedCounts['over-cap']).toBeGreaterThan(0);
  }, 60_000);
});

describe.skipIf(!hasChrome)('session from a signed-in browser (CDP)', () => {
  it('copies only the site\'s cookies, opens no tab, and leaves that browser running', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'eqd-cdp-'));
    const chrome = spawn(findChrome()!, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
    try {
      let port = '';
      for (let i = 0; i < 100 && !port; i++) {
        await sleep(100);
        try {
          port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]!;
        } catch {
          /* not yet */
        }
      }
      const endpoint = `http://127.0.0.1:${port}`;
      const setup = await chromium.connectOverCDP(endpoint);
      const ctx = setup.contexts()[0]!;
      await ctx.addCookies([
        { name: 'sid', value: 'ok', domain: 'app.example.test', path: '/' },
        { name: 'mail', value: 'x', domain: '.mail.example.org', path: '/' },
      ]);
      const tabsBefore = ctx.pages().length;
      await setup.close();

      const { state, summary } = await sessionFromCdp(endpoint, new URL('https://app.example.test/'));
      expect(state.cookies?.map((c) => c.name)).toEqual(['sid']);
      expect(summary).toEqual({ source: 'cdp', cookies: 1, droppedCookies: 1, localStorageOrigins: 0 });

      const after = await chromium.connectOverCDP(endpoint);
      expect(after.contexts()[0]!.pages().length).toBe(tabsBefore);
      expect((await after.contexts()[0]!.cookies()).length).toBe(2);
      await after.close();
    } finally {
      const exited = new Promise((r) => chrome.once('exit', r));
      chrome.kill();
      await exited;
      // Chrome's helper processes can still be writing the profile after the main one exits
      // (seen on Linux CI); a leftover temp dir is not a test failure.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        /* left in tmp */
      }
    }
  }, 60_000);
});
