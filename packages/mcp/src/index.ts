import { readdirSync } from 'node:fs';
import type { Tool } from './tool.ts';

export type { Tool };
export { serve, handle, PROTOCOL_VERSIONS, type ServerInfo } from './server.ts';
export { getEngine, setEngine, fakeEngine, type Engine, type ExtractRequest, type ExtractOutcome } from './engine.ts';
export { ownBrowserLaunch, assertOwnBrowser, scrubEnv, SharedBrowserError, type LaunchPlan } from './browser.ts';

export const SERVER_NAME = 'design';

const TOOLS_DIR = new URL('./tools/', import.meta.url);

/** Every `tools/*.ts` (or built `.js`) that exports `tool` (or `tools`, for a family of tools), sorted by name. */
export async function loadTools(dir: URL = TOOLS_DIR): Promise<Tool[]> {
  const files = readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f) && !/\.(d|test)\.ts$/.test(f));
  const tools: Tool[] = [];
  for (const f of files) {
    const mod = (await import(new URL(f, dir).href)) as { tool?: Tool; tools?: Tool[] };
    if (!mod.tool && !mod.tools) throw new Error(`tools/${f} does not export \`tool\``);
    if (mod.tool) tools.push(mod.tool);
    if (mod.tools) tools.push(...mod.tools);
  }
  const names = new Set<string>();
  for (const t of tools) {
    if (names.has(t.name)) throw new Error(`two tools are named "${t.name}"`);
    names.add(t.name);
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}
