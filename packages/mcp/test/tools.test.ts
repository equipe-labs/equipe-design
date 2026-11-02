import { describe, expect, it } from 'vitest';
import { loadTools } from '../src/index.ts';

describe('MCP tool registry', () => {
  it('has no tools yet', async () => {
    expect(await loadTools()).toEqual([]);
  });

  it('registers every file in tools/ by itself', async () => {
    const tools = await loadTools(new URL('./fixtures/tools/', import.meta.url));
    expect(tools.map((t) => t.name)).toEqual(['design_ping']);
  });
});
