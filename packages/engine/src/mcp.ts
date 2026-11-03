// The engine as the MCP server's `design_extract` sees it (the `Engine` shape in
// packages/mcp/src/engine.ts, kept structural so the engine doesn't depend on the MCP package).
// The MCP side checks the launch plan with assertOwnBrowser before calling this; the engine then
// starts its own headless Chrome (Playwright launch, fresh temporary profile, never a connect).

import { extract } from './extract.ts';
import { writeRun } from './write.ts';

export interface McpExtractRequest {
  urls: string[];
  outDir: string;
  widths?: number[];
  modes?: 'auto' | 'light' | 'dark' | 'both';
  states?: boolean;
  browser: unknown;
}

export const mcpEngine = {
  name: 'equipe-design engine',
  fake: false as const,
  async extract(req: McpExtractRequest): Promise<{ extractPath: string; reportPath: string }> {
    const r = await extract(req.urls, {
      ...(req.widths ? { widths: req.widths } : {}),
      ...(req.modes ? { modes: req.modes } : {}),
      ...(req.states !== undefined ? { states: req.states } : {}),
    });
    const { extractPath, reportPath } = writeRun(r.extraction, req.outDir);
    return { extractPath, reportPath };
  },
};
