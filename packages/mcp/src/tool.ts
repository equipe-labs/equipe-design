/**
 * One MCP tool. Each file in `tools/` exports `tool`; `loadTools()` picks it up, so each
 * ticket adds its own file. Big results go to files: return paths and a summary, not the JSON.
 */
export interface Tool {
  /** e.g. `design_extract` → seen by agents as `mcp__design__design_extract`. */
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>): Promise<unknown>;
}
