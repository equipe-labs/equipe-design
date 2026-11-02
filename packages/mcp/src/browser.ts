// The engine's browser is its own: a fresh headless Chrome with a temporary profile, spoken to
// over a pipe. It never connects to an existing browser — above all not the equipe members'
// shared one (a `browser` MCP server on a localhost port, with the person's sign-ins in it):
// its cookies would follow the engine onto every page it reads.

import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** How the engine starts Chrome. `connect` is not a choice: there is nothing to connect to. */
export interface LaunchPlan {
  mode: 'launch';
  headless: true;
  /** A new, empty profile for this run (deleted after). */
  userDataDir: string;
  /** Chrome flags. CDP goes over a pipe, so no debugging port is opened. */
  args: string[];
  /** Environment for anything the engine spawns, without browser endpoints in it. */
  env: Record<string, string>;
}

/** Environment variables that point a browser library at a running browser instead of launching one. */
const ENDPOINT_VARS = /^(PLAYWRIGHT_.*(ENDPOINT|CDP|WS).*|PW_.*ENDPOINT.*|PUPPETEER_.*(ENDPOINT|WS|URL).*|.*BROWSER_?(WS|URL|ENDPOINT|PORT).*|.*CDP.*|CHROME_(REMOTE|DEBUG).*|EQUIPE_BROWSER.*)$/i;

/** `env` without anything that names a running browser. */
export function scrubEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !ENDPOINT_VARS.test(k)) out[k] = v;
  return out;
}

export function ownBrowserLaunch(env: NodeJS.ProcessEnv = process.env): LaunchPlan {
  return {
    mode: 'launch',
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), 'eqd-chrome-')),
    args: ['--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check'],
    env: scrubEnv(env),
  };
}

export class SharedBrowserError extends Error {}

/** Profiles that hold someone's sign-ins: equipe's browser home and Chrome's own. */
function signedInProfiles(home = homedir()): string[] {
  return [
    join(home, '.equipe'),
    join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    join(home, 'Library', 'Application Support', 'Chromium'),
    join(home, '.config', 'google-chrome'),
    join(home, '.config', 'chromium'),
  ];
}

/**
 * Refuses any plan that would reach a browser the engine didn't start: a connect mode, a CDP or
 * WebSocket endpoint, a debugging port, or a profile that holds someone's sign-ins.
 * The engine calls this before it starts Chrome.
 */
export function assertOwnBrowser(plan: unknown, home = homedir()): asserts plan is LaunchPlan {
  const p = plan as Partial<LaunchPlan> & Record<string, unknown>;
  if (!p || p.mode !== 'launch') throw new SharedBrowserError('the engine only launches its own browser; it never connects to one');
  for (const key of ['endpoint', 'wsEndpoint', 'cdpEndpoint', 'browserURL', 'browserWSEndpoint', 'port']) {
    if (key in p) throw new SharedBrowserError(`"${key}" would connect to a running browser`);
  }
  for (const a of p.args ?? []) {
    if (/^--remote-debugging-(port|address)/.test(a)) throw new SharedBrowserError(`${a} opens a port others could attach to`);
    if (/^--user-data-dir/.test(a)) throw new SharedBrowserError('the profile is set by userDataDir only');
  }
  if (typeof p.userDataDir !== 'string' || !p.userDataDir) throw new SharedBrowserError('a fresh userDataDir is required');
  const dir = resolve(p.userDataDir);
  for (const signedIn of signedInProfiles(home)) {
    if (dir === signedIn || dir.startsWith(signedIn + sep)) throw new SharedBrowserError(`${dir} is a signed-in profile`);
  }
  for (const k of Object.keys(p.env ?? {})) if (ENDPOINT_VARS.test(k)) throw new SharedBrowserError(`env ${k} names a running browser`);
}
