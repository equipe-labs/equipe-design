// The signed-in state a crawl reads with. Never a password: either a Playwright storageState
// file the user's agent saved, or the address (CDP) of a browser the user's agent already signed
// in with. From either, only the cookies and localStorage of the site being crawled are kept;
// the crawl then reads in its own headless browser, so the other browser's tabs, other sites'
// sign-ins and its history are never touched. Nothing of the session is written to the result.
//
// Connecting to a running browser happens here only, only to the address the user gave
// (never one found in the environment), and only to copy that site's session.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import type { StorageState } from '../capture/page.ts';

export type SessionSource = { kind: 'none' } | { kind: 'storage-state'; path: string } | { kind: 'cdp'; endpoint: string };

export interface SessionSummary {
  source: SessionSource['kind'];
  /** Cookies kept for the crawled site. */
  cookies: number;
  /** Cookies of other sites that were dropped. */
  droppedCookies: number;
  /** Origins whose localStorage was kept (only the crawled one). */
  localStorageOrigins: number;
}

export class SessionError extends Error {}

type Cookie = StorageState extends infer S ? (S extends { cookies: (infer C)[] } ? C : never) : never;
type Origin = StorageState extends infer S ? (S extends { origins: (infer O)[] } ? O : never) : never;

/** Cookie domain `.example.com` or `example.com` applies to `app.example.com`. */
export function cookieApplies(domain: string, host: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase();
  const h = host.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Keeps only what belongs to `site`: its cookies (and parent-domain ones) and its own origin's storage. */
export function scopeSession(state: { cookies?: unknown; origins?: unknown }, site: URL): { state: StorageState; summary: Omit<SessionSummary, 'source'> } {
  if (!Array.isArray(state.cookies) || (state.origins !== undefined && !Array.isArray(state.origins))) {
    throw new SessionError('세션 파일이 Playwright storageState 형식이 아님({ cookies: [], origins: [] })');
  }
  const cookies = (state.cookies as Cookie[]).filter((c) => c && typeof c.name === 'string' && typeof c.domain === 'string');
  const kept = cookies.filter((c) => cookieApplies(c.domain, site.hostname));
  const origins = ((state.origins ?? []) as Origin[]).filter((o) => o && o.origin === site.origin);
  return {
    state: { cookies: kept, origins },
    summary: { cookies: kept.length, droppedCookies: cookies.length - kept.length, localStorageOrigins: origins.length },
  };
}

export function sessionFromFile(path: string, site: URL): { state: StorageState; summary: SessionSummary } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new SessionError(`세션 파일을 읽지 못함: ${path} (${(e as Error).message})`);
  }
  const { state, summary } = scopeSession(raw as Record<string, unknown>, site);
  return { state, summary: { source: 'storage-state', ...summary } };
}

/**
 * Copies `site`'s cookies (and the localStorage of a tab already open on it) from the browser
 * at `endpoint`, then disconnects. Opens no tab, navigates nothing, closes nothing there.
 */
export async function sessionFromCdp(endpoint: string, site: URL): Promise<{ state: StorageState; summary: SessionSummary }> {
  let ep: URL;
  try {
    ep = new URL(endpoint);
  } catch {
    throw new SessionError(`CDP 주소가 아님: ${endpoint}`);
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(ep.protocol)) throw new SessionError(`CDP 주소는 http(s):// 또는 ws(s):// 여야 함: ${endpoint}`);
  let remote;
  try {
    remote = await chromium.connectOverCDP(ep.href, { timeout: 15_000 });
  } catch (e) {
    throw new SessionError(`CDP 주소의 브라우저에 붙지 못함: ${endpoint} (${String((e as Error).message).split('\n')[0]})`);
  }
  try {
    const all: Cookie[] = [];
    const origins: Origin[] = [];
    for (const ctx of remote.contexts()) {
      all.push(...((await ctx.cookies()) as Cookie[]));
      if (origins.length) continue;
      const tab = ctx.pages().find((p) => {
        try {
          return new URL(p.url()).origin === site.origin;
        } catch {
          return false;
        }
      });
      if (!tab) continue;
      // Reads localStorage of a tab already open on the site; writes nothing.
      const localStorage = await tab.evaluate(() => Object.entries(window.localStorage).map(([name, value]) => ({ name, value }))).catch(() => null);
      if (localStorage) origins.push({ origin: site.origin, localStorage } as Origin);
    }
    const { state, summary } = scopeSession({ cookies: all, origins }, site);
    return { state, summary: { source: 'cdp', ...summary } };
  } finally {
    // For a browser reached over CDP, close() only drops the connection; the browser keeps running.
    await remote.close().catch(() => undefined);
  }
}

export async function loadSession(src: SessionSource, site: URL): Promise<{ state?: StorageState; summary: SessionSummary }> {
  if (src.kind === 'storage-state') return sessionFromFile(src.path, site);
  if (src.kind === 'cdp') return sessionFromCdp(src.endpoint, site);
  return { summary: { source: 'none', cookies: 0, droppedCookies: 0, localStorageOrigins: 0 } };
}
