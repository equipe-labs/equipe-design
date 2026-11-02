import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTools } from '../src/index.ts';
import { handle } from '../src/server.ts';
import type { Tool } from '../src/tool.ts';

describe('MCP tool registry', () => {
  it('serves the four design tools', async () => {
    expect((await loadTools()).map((t) => t.name)).toEqual(['design_emit', 'design_extract', 'design_remix', 'design_report']);
  });

  it('registers every file in tools/ by itself', async () => {
    const tools = await loadTools(new URL('./fixtures/tools/', import.meta.url));
    expect(tools.map((t) => t.name)).toEqual(['design_ping']);
  });

  it('picks up a tool file dropped into the folder, with nothing else edited', async () => {
    const dir = new URL(`./.tmp-tools-${process.pid}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    const toolTs = new URL('../src/tool.ts', import.meta.url).href;
    writeFileSync(new URL('design_library.ts', dir), `import type { Tool } from '${toolTs}';\nexport const tool: Tool = { name: 'design_library', description: 'x', inputSchema: { type: 'object' }, async handler() { return { ok: 1 }; } };\n`);
    writeFileSync(new URL('notes.md', dir), 'not a tool');
    try {
      const tools = await loadTools(dir);
      expect(tools.map((t) => t.name)).toEqual(['design_library']);
      const listed = (await handle(tools, { name: 'design', version: '0' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })) as { result: { tools: Tool[] } };
      expect(listed.result.tools.map((t) => t.name)).toEqual(['design_library']);
    } finally {
      (await import('node:fs')).rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a tool file without `tool` and two tools with one name', async () => {
    const dir = new URL(`./.tmp-bad-${process.pid}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(new URL('a.ts', dir), 'export const nope = 1;\n');
      await expect(loadTools(dir)).rejects.toThrow(/does not export `tool`/);
      const body = `export const tool = { name: 'same', description: '', inputSchema: {}, async handler() { return 1; } };\n`;
      const dup = new URL('dup/', dir);
      mkdirSync(dup);
      writeFileSync(new URL('a.ts', dup), body);
      writeFileSync(new URL('b.ts', dup), body);
      await expect(loadTools(dup)).rejects.toThrow(/two tools are named "same"/);
    } finally {
      (await import('node:fs')).rmSync(dir, { recursive: true, force: true });
    }
  });

  it('every tool has an object input schema and a description', async () => {
    for (const t of await loadTools()) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });
});
