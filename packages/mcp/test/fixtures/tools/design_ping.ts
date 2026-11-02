import type { Tool } from '../../../src/tool.ts';

export const tool: Tool = {
  name: 'design_ping',
  description: 'Fixture tool',
  inputSchema: { type: 'object', properties: {} },
  async handler() {
    return { ok: true };
  },
};
