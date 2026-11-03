// The engine never reaches the equipe members' shared browser (a `browser` MCP server on a localhost port).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertOwnBrowser, ownBrowserLaunch, scrubEnv, SharedBrowserError } from '../src/browser.ts';
import { getEngine, setEngine, type ExtractRequest } from '../src/engine.ts';
import { tool as extract } from '../src/tools/design_extract.ts';
import { Client } from './client.ts';

describe('own browser only', () => {
  it('launches a fresh headless Chrome over a pipe, with no port and a temporary profile', () => {
    const plan = ownBrowserLaunch({ PATH: '/bin', PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://localhost:9222', EQUIPE_BROWSER_PORT: '9222' });
    expect(plan).toMatchObject({ mode: 'launch', headless: true });
    expect(plan.args).toContain('--remote-debugging-pipe');
    expect(plan.args.join(' ')).not.toMatch(/remote-debugging-port|user-data-dir/);
    expect(plan.userDataDir.startsWith(tmpdir())).toBe(true);
    expect(plan.env).toEqual({ PATH: '/bin' });
    expect(() => assertOwnBrowser(plan)).not.toThrow();
  });

  it('refuses anything that would connect to a running browser', () => {
    const ok = ownBrowserLaunch({});
    const bad: unknown[] = [
      { ...ok, mode: 'connect' },
      { ...ok, cdpEndpoint: 'http://localhost:51234' },
      { ...ok, wsEndpoint: 'ws://localhost:51234/devtools/browser/x' },
      { ...ok, browserURL: 'http://127.0.0.1:51234' },
      { ...ok, port: 51234 },
      { ...ok, args: ['--remote-debugging-port=9222'] },
      { ...ok, args: ['--user-data-dir=/x'] },
      { ...ok, userDataDir: join(homedir(), '.equipe', 'browser', 'profile') },
      { ...ok, userDataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome') },
      { ...ok, env: { PLAYWRIGHT_MCP_CDP_ENDPOINT: 'http://localhost:51234' } },
      undefined,
    ];
    for (const b of bad) expect(() => assertOwnBrowser(b), JSON.stringify(b)).toThrow(SharedBrowserError);
  });

  it('drops browser endpoints from the environment it passes on', () => {
    const env = scrubEnv({ HOME: '/h', PUPPETEER_BROWSER_WS_ENDPOINT: 'ws://x', BROWSER_WS_ENDPOINT: 'ws://x', CHROME_REMOTE_DEBUGGING_PORT: '1', PW_TEST_CONNECT_WS_ENDPOINT: 'ws://x' });
    expect(env).toEqual({ HOME: '/h' });
  });

  it('design_extract hands the engine its own browser and removes the profile after', async () => {
    let seen: ExtractRequest | undefined;
    setEngine({
      name: 'spy', fake: true,
      async extract(req) {
        seen = req;
        assertOwnBrowser(req.browser);
        throw new Error('stop here');
      },
    });
    const prev = process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
    process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT = 'http://localhost:51234';
    try {
      await expect(extract.handler({ urls: ['https://equipe.im/'], outDir: tmpdir() })).rejects.toThrow('stop here');
    } finally {
      setEngine(undefined);
      if (prev === undefined) delete process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT;
      else process.env.PLAYWRIGHT_MCP_CDP_ENDPOINT = prev;
    }
    expect(seen!.browser.mode).toBe('launch');
    expect(seen!.browser.env.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBeUndefined();
    expect(() => statSync(seen!.browser.userDataDir)).toThrow();
  });

  it('the real engine is the default, and it refuses a shared browser before starting one', async () => {
    const engine = await getEngine({});
    expect(engine).toMatchObject({ name: 'equipe-design engine', fake: false });
    expect((await getEngine({ EQUIPE_DESIGN_ENGINE: 'fake' })).fake).toBe(true);
    const shared = { mode: 'launch', headless: true, userDataDir: tmpdir(), args: ['--remote-debugging-port=9222'], env: {} };
    await expect(engine.extract({ urls: ['https://equipe.im/'], outDir: tmpdir(), browser: shared as never })).rejects.toThrow(SharedBrowserError);
  });

  it('no package source connects to an existing browser', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const connect = /connectOverCDP|\.connect\(\s*\{[^}]*(browserURL|browserWSEndpoint|wsEndpoint)|cdpEndpoint|--remote-debugging-port|localhost:\d+\/mcp/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (n === 'node_modules' || n === 'test') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(n) && !p.endsWith(join('mcp', 'src', 'browser.ts')) && connect.test(readFileSync(p, 'utf8'))) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

describe('with a shared browser server running', () => {
  let server: Server;
  let port = 0;
  let connections = 0;
  beforeAll(async () => {
    server = createServer((s) => {
      connections++;
      s.destroy();
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((res) => server.close(() => res())));

  it('a whole extract never opens a connection to it', async () => {
    const endpoint = `http://localhost:${port}`;
    const client = Client.start({
      EQUIPE_DESIGN_ENGINE: 'fake',
      PLAYWRIGHT_MCP_CDP_ENDPOINT: endpoint,
      PUPPETEER_BROWSER_WS_ENDPOINT: `ws://localhost:${port}/devtools/browser/x`,
      EQUIPE_BROWSER_URL: `${endpoint}/mcp`,
    });
    await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    const dir = join(tmpdir(), `eqd-shared-${process.pid}`);
    const r = await client.call('design_extract', { urls: ['https://equipe.im/'], outDir: dir });
    expect(r.isError, r.text).toBeUndefined();
    await client.close();
    expect(connections).toBe(0);
  });
});
