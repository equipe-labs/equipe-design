import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { baseUrlFrom, createClient, DEFAULT_BASE_URL, LibraryError, USER_AGENT } from '../src/index.ts';
import { Client as McpClient } from '../../mcp/test/client.ts';
import { startFakeServer, type FakeServer } from './fake-server.ts';

const BIN = fileURLToPath(new URL('../../cli/bin/equipe-design.js', import.meta.url));
const run = promisify(execFile);

let api: FakeServer;
let work: string;
beforeAll(async () => {
  api = await startFakeServer();
  work = mkdtempSync(join(tmpdir(), 'eqd-library-'));
});
afterAll(async () => {
  await api.close();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(() => { api.seen.length = 0; });

async function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await run(process.execPath, [BIN, 'library', ...args], { cwd: work, env: { ...process.env, EQUIPE_DESIGN_API: api.url } });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string };
    return { code: x.code, stdout: x.stdout, stderr: x.stderr };
  }
}

describe('client', () => {
  it('takes its address from EQUIPE_DESIGN_API, else equipe.im', () => {
    expect(DEFAULT_BASE_URL).toBe('https://equipe.im/api/design/v1');
    expect(baseUrlFrom({})).toBe(DEFAULT_BASE_URL);
    expect(baseUrlFrom({ EQUIPE_DESIGN_API: 'http://localhost:3000/api/design/v1/' })).toBe('http://localhost:3000/api/design/v1');
    expect(createClient({ env: { EQUIPE_DESIGN_API: api.url } }).baseUrl).toBe(api.url);
  });

  it('lists, gets and follows the tokens redirect, with its User-Agent', async () => {
    const c = createClient({ baseUrl: api.url });
    const list = await c.listStyles({ q: 'neutral', hasDark: true });
    expect(list.styles.map((s) => s.slug)).toContain('hush');
    expect(api.seen[0]).toMatchObject({ path: '/api/design/v1/styles', query: { q: 'neutral', hasDark: 'true' }, userAgent: USER_AGENT });
    expect(USER_AGENT).toMatch(/^equipe-design\/\d+\.\d+\.\d+$/);
    const d = await c.getStyle('hush');
    const byStyle = await c.getTokens({ style: 'hush' }, 'css');
    expect(byStyle.releaseId).toBe(d.release.id);
    expect(Object.keys(byStyle.files)).toEqual(['tokens.css']);
    expect((await c.getReleases('hush')).releases.length).toBeGreaterThan(0);
    expect((await c.meta()).apiVersion).toBe('1');
  });

  it('retries once, then gives up', async () => {
    const c = createClient({ baseUrl: api.url, retryDelayMs: 1 });
    api.failNext(1);
    expect((await c.listStyles()).total).toBe(3);
    expect(api.seen.length).toBe(2);
    api.failNext(2);
    await expect(c.listStyles()).rejects.toMatchObject({ status: 503, code: 'internal' });
  });

  it('turns an error body into LibraryError, and an unreachable server into status 0', async () => {
    const c = createClient({ baseUrl: api.url });
    const e = await c.getStyle('nope').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LibraryError);
    expect(e).toMatchObject({ status: 404, code: 'not_found' });
    await expect(createClient({ baseUrl: 'http://127.0.0.1:9', retryDelayMs: 1 }).meta()).rejects.toMatchObject({ status: 0, code: 'unreachable' });
  });
});

describe('equipe-design library (against a fake server)', () => {
  it('list prints the styles', async () => {
    const r = await cli('list');
    expect(r.code).toBe(0);
    for (const s of ['hush', 'klaxon', 'tessel']) expect(r.stdout).toContain(s);
    expect(r.stdout).toContain('3 of 3');
  });

  it('show prints one style and its notice', async () => {
    const r = await cli('show', 'hush');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Hush \(hush\)/);
    expect(r.stdout).toContain('An original style');
    expect((await cli('show', 'nope')).code).toBe(1);
  });

  it('pull --to css,dtcg writes the files', async () => {
    const r = await cli('pull', 'hush', '--to', 'css,dtcg,swift', '--out', 'pulled');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(join(work, 'pulled', 'tokens.css'), 'utf8')).toContain('--eq-color-background');
    expect(readdirSync(join(work, 'pulled', 'dtcg')).sort()).toEqual(['component.json', 'primitive.json', 'semantic.color.dark.json', 'semantic.color.light.json', 'semantic.json']);
    expect(existsSync(join(work, 'pulled', 'EqTokens.swift'))).toBe(true);
  });

  it('remix computes locally — no POST /remix — and pull turns the remix into code', async () => {
    const r = await cli('remix', 'hush', '--brand', '#0f766e', '--variants', '2', '--no-sheet', '--out', 'mine');
    expect(r.code, r.stderr).toBe(0);
    expect(api.seen.some((s) => s.method === 'POST' || s.path.endsWith('/remix'))).toBe(false);
    expect(api.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(readdirSync(join(work, 'mine')).sort()).toEqual(['a', 'b']);
    const css = readFileSync(join(work, 'mine', 'a', 'tokens.css'), 'utf8');
    expect(css).toContain('#0f766e');
    expect(existsSync(join(work, 'mine', 'a', 'tokens', 'semantic.color.light.json'))).toBe(true);

    api.seen.length = 0;
    const p = await cli('pull', 'mine/a', '--to', 'tailwind,kotlin', '--prefix', 'acme');
    expect(p.code, p.stderr).toBe(0);
    expect(api.seen).toEqual([]);
    expect(readFileSync(join(work, 'mine', 'a', 'theme.css'), 'utf8')).toContain('#0f766e');
    expect(existsSync(join(work, 'mine', 'a', 'AcmeTokens.kt'))).toBe(true);
  });

  it('refuses a bad colour and an unknown format', async () => {
    expect((await cli('remix', 'hush', '--brand', 'teal', '--no-sheet')).stderr).toMatch(/hex/);
    expect((await cli('pull', 'hush', '--to', 'pdf')).stderr).toMatch(/unknown format "pdf"/);
  });
});

describe('MCP library tools', () => {
  it('lists the three tools and keeps design_library_pull under 4 KB', async () => {
    const mcp = McpClient.start({ EQUIPE_DESIGN_API: api.url }, work);
    try {
      await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
      const names = ((await mcp.request('tools/list')).result as { tools: { name: string }[] }).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['design_library_search', 'design_library_get', 'design_library_pull']));

      const found = await mcp.call('design_library_search', { q: 'neutral' });
      expect(found.isError).toBeUndefined();
      expect((found.structured.styles as { slug: string }[]).map((s) => s.slug)).toContain('hush');
      const got = await mcp.call('design_library_get', { style: 'klaxon' });
      expect(got.structured).toMatchObject({ slug: 'klaxon', name: 'Klaxon' });

      const pulled = await mcp.call('design_library_pull', { style: 'hush', outDir: 'mcp-pull', formats: ['dtcg', 'css', 'tailwind', 'shadcn', 'swift', 'kotlin'] });
      expect(pulled.isError, pulled.text).toBeUndefined();
      expect(Buffer.byteLength(pulled.text)).toBeLessThanOrEqual(4096);
      expect(existsSync(join(work, 'mcp-pull', 'tokens.css'))).toBe(true);

      api.seen.length = 0;
      const remixed = await mcp.call('design_library_pull', { style: 'hush', outDir: 'mcp-remix', brand: '#0f766e', formats: ['css', 'tailwind'] });
      expect(remixed.isError, remixed.text).toBeUndefined();
      expect(Buffer.byteLength(remixed.text)).toBeLessThanOrEqual(4096);
      expect((remixed.structured.variants as unknown[]).length).toBe(3);
      expect(api.seen.every((s) => s.method === 'GET')).toBe(true);
    } finally {
      await mcp.close();
    }
  }, 120_000);
});

describe('writeFiles', () => {
  it('refuses a file name that climbs out of the folder', async () => {
    const { writeFiles } = await import('../src/local.ts');
    expect(() => writeFiles(join(work, 'safe'), { '../escape.css': 'x' })).toThrow(/outside/);
    expect(existsSync(join(work, 'escape.css'))).toBe(false);
  });
});
