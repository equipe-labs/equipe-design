import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExtraction } from '@equipe-design/schema';
import { extract, findChrome, writeRun } from '../src/index.ts';
import { startSite, type TestSite } from './fixtures/server.ts';

// Guardrails against a local test site. The robots test needs no browser (it stops before
// one is opened); the rest need Chrome and are skipped where there is none.

const hasChrome = findChrome() !== null;
let site: TestSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

const pageRequests = (s: TestSite) => s.requests.filter((r) => r.path !== '/robots.txt');

describe('robots.txt', () => {
  it('stops with exit code 2 and makes no page request when robots.txt disallows the path', async () => {
    site = await startSite({ robots: 'User-agent: *\nDisallow: /\n' });
    const { extraction: x, exitCode, requests } = await extract([`${site.url}/`]);
    expect(exitCode).toBe(2);
    expect(x.run.stoppedBy).toBe('robots-disallowed');
    expect(x.limits[0]?.kind).toBe('robots-disallowed');
    expect(x.limits[0]?.reason).toContain('Disallow: /');
    expect(x.guardrails.pagesVisited).toBe(0);
    expect(x.tool.chrome).toBeNull();
    expect(requests).toEqual([]);
    expect(pageRequests(site)).toEqual([]);
    expect(site.requests).toEqual([{ method: 'GET', path: '/robots.txt' }]);
    expect(validateExtraction(x)).toEqual({ ok: true, value: x });
  });

  it('obeys a group for our own user agent over *', async () => {
    site = await startSite({ robots: 'User-agent: *\nAllow: /\n\nUser-agent: equipe-design\nDisallow: /private\n' });
    const { exitCode } = await extract([`${site.url}/private/x`]);
    expect(exitCode).toBe(2);
    expect(pageRequests(site)).toEqual([]);
  });
});

describe.skipIf(!hasChrome)('guardrails in the browser', () => {
  it('stops at a login wall (a password field standing in for the page)', async () => {
    site = await startSite();
    const { extraction: x, exitCode } = await extract([`${site.url}/login`], { widths: [800], states: false });
    expect(exitCode).toBe(2);
    expect(x.run.stoppedBy).toBe('login-required');
    expect(x.source.pages[0]!.loginWall).toBe(true);
    expect(x.observed.color).toEqual([]);
    expect(validateExtraction(x).ok).toBe(true);
  }, 60_000);

  it('blocks POST and beacons: nothing but GET reaches the server', async () => {
    site = await startSite();
    const { extraction: x, exitCode } = await extract([`${site.url}/post`], { widths: [800], states: false });
    expect(exitCode).toBe(0);
    expect(site.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    expect(x.guardrails.mutatingRequestsBlocked).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('reads five of six URLs and says so', async () => {
    site = await startSite();
    const urls = ['/', '/a', '/b', '/c', '/d', '/e'].map((p) => site!.url + p);
    const { extraction: x } = await extract(urls, { widths: [800], states: false, modes: 'light' });
    expect(x.source.pages).toHaveLength(5);
    expect(x.guardrails.pagesVisited).toBe(5);
    expect(new Set(pageRequests(site).filter((r) => r.method === 'GET').map((r) => r.path))).toEqual(new Set(['/', '/a', '/b', '/c', '/d']));
    expect(x.limits.some((l) => l.kind === 'page-cap-reached')).toBe(true);
  }, 90_000);

  it('extracts the local page: schema passes, values come from what the page renders', async () => {
    site = await startSite();
    const { extraction: x, exitCode } = await extract([`${site.url}/`]);
    expect(exitCode).toBe(0);
    const check = validateExtraction(x);
    expect(check.ok ? [] : check.issues).toEqual([]);
    const hex = new Map(x.observed.color.map((c) => [c.id, c.value.hex]));
    const role = (r: string) => x.inferred.roles!.find((x) => x.role === r)!;
    expect(hex.get(role('background').light!)).toBe('#f6f5f1');
    expect(hex.get(role('background').dark!)).toBe('#0a0a0c');
    expect(x.source.modes.dark.method).toBe('media-query');
    expect(x.inferred.scales!.spacing!.steps).toEqual([4, 8, 16]);
    // The accent fills the buttons and colours the links, and a variable calls it --accent.
    expect(x.inferred.brand!.status).toBe('found');
    expect(hex.get(x.inferred.brand!.color!)).toBe('#1d4ed8');
    const button = x.inferred.components!.find((c) => c.kind === 'button')!;
    expect(button.variants[0]!.states.hover.observed).toBe(true);
    expect(button.variants[0]!.states.hover.diff!['background-color']).toMatch(/^c\d+ -> c\d+$/);
  }, 60_000);

  it('writes only extract.json and report.md: no CSS, font or image files', async () => {
    site = await startSite();
    const { extraction: x } = await extract([`${site.url}/`], { widths: [800] });
    const dir = mkdtempSync(join(tmpdir(), 'eqd-run-'));
    try {
      writeRun(x, dir);
      const files = readdirSync(dir, { recursive: true }).map(String);
      expect(files.sort()).toEqual(['extract.json', 'report.md']);
      expect(files.some((f) => /\.(css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico)$/i.test(f))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
