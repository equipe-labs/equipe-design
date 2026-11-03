// `equipe-design mcp` driven by a test client, as Claude Code would.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from './client.ts';

describe('equipe-design mcp over stdio', () => {
  let client: Client;
  let out: string;
  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'eqd-mcp-'));
    client = Client.start({ EQUIPE_DESIGN_ENGINE: 'fake' });
    const init = (await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })).result as Record<string, unknown>;
    expect(init).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'design' }, capabilities: { tools: {} } });
    client.notify('notifications/initialized');
  });
  afterAll(async () => {
    expect(await client.close()).toBe(0);
    rmSync(out, { recursive: true, force: true });
  });

  it('lists the design tools', async () => {
    const r = (await client.request('tools/list')).result as { tools: { name: string }[] };
    expect(r.tools.map((t) => t.name)).toEqual(['design_emit', 'design_extract', 'design_library_get', 'design_library_pull', 'design_library_search', 'design_remix', 'design_report']);
  });

  it('design_extract returns paths and a summary, not the JSON', async () => {
    const dir = join(out, 'extract', 'equipe.im');
    const r = await client.call('design_extract', { urls: ['https://equipe.im/'], outDir: dir });
    expect(r.isError).toBeUndefined();
    expect(r.structured).toMatchObject({ extractPath: join(dir, 'extract.json'), reportPath: join(dir, 'report.md') });
    expect(r.structured.summary).toMatch(/^FAKE ENGINE .*24 colors.*brand c3 #1d4ed8.*17 dark pairs/);
    expect(r.structured.limits).toContainEqual(expect.objectContaining({ kind: 'single-page' }));
    expect(r.structured.stopped).toBeUndefined();
    expect(r.text.length).toBeLessThan(3000);
    expect(r.text).not.toContain('"observed"');
    expect(existsSync(join(dir, 'extract.json'))).toBe(true);
  });

  it('a guardrail stop is a result, not an error', async () => {
    const r = await client.call('design_extract', { urls: ['https://robots-blocked.example/app/'], outDir: join(out, 'blocked') });
    expect(r.isError).toBeUndefined();
    expect(r.structured).toMatchObject({ stopped: 'robots-disallowed', limits: [{ kind: 'robots-disallowed' }] });
  });

  it('bad arguments come back as tool errors', async () => {
    expect((await client.call('design_extract', { urls: [], outDir: out })).isError).toBe(true);
    expect((await client.call('design_extract', { urls: Array(6).fill('https://equipe.im/'), outDir: out })).text).toMatch(/1–5 items/);
    expect((await client.call('design_extract', { urls: ['file:///etc/passwd'], outDir: out })).text).toMatch(/only http/);
    expect((await client.request('tools/call', { name: 'nope', arguments: {} })).error).toMatchObject({ code: -32602 });
  });

  it('design_report → design_remix → design_emit', async () => {
    const extract = join(out, 'extract', 'equipe.im', 'extract.json');
    if (!existsSync(extract)) await client.call('design_extract', { urls: ['https://equipe.im/'], outDir: join(out, 'extract', 'equipe.im') });
    const report = await client.call('design_report', { extractPath: extract });
    expect(report.text).toMatch(/## Limits/);

    const remix = await client.call('design_remix', { extractPaths: [extract], brand: { color: '#0f766e', name: 'Tidewater' }, variants: 2, outDir: join(out, 'remix') });
    expect(remix.isError, remix.text).toBeUndefined();
    const variants = remix.structured.variants as { id: string; tokensDir: string; contrastFails: number }[];
    expect(variants.map((v) => v.id)).toEqual(['a', 'b']);
    expect(readdirSync(variants[0]!.tokensDir)).toContain('semantic.json');

    const emitted = await client.call('design_emit', { tokensDir: variants[0]!.tokensDir, formats: ['css', 'dtcg'], outDir: join(out, 'design'), dtcgLegacy: true });
    expect(emitted.isError, emitted.text).toBeUndefined();
    const files = emitted.structured.files as string[];
    expect(files).toContain(join(out, 'design', 'tokens.css'));
    expect(files).toContain(join(out, 'design', 'tokens.json'));
    expect(readFileSync(join(out, 'design', 'tokens.css'), 'utf8')).toMatch(/--eq-/);
  }, 120_000);
});
