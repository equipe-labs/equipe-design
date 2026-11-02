// A small MCP server over stdio: newline-delimited JSON-RPC 2.0, the tools capability only.
// Enough for Claude Code, Codex and the MCP inspector, without an SDK dependency.

import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { Tool } from './tool.ts';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface ServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

/** Answers one message; `undefined` for notifications. */
export async function handle(tools: Tool[], info: ServerInfo, msg: Request): Promise<object | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return undefined; // notifications/initialized, cancelled…
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: info.name, version: info.version },
        ...(info.instructions ? { instructions: info.instructions } : {}),
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const tool = tools.find((t) => t.name === name);
      if (!tool) return fail(-32602, `unknown tool "${name}"`);
      try {
        const result = await tool.handler((msg.params?.arguments ?? {}) as Record<string, unknown>);
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return reply({
          content: [{ type: 'text', text }],
          ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {}),
        });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${msg.method}`);
  }
}

/** Serves until `input` ends. Logs go to `log` (stderr), never to `output`. */
export async function serve(tools: Tool[], info: ServerInfo, input: Readable, output: Writable, log: Writable): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: Request;
    try {
      msg = JSON.parse(line) as Request;
    } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      continue;
    }
    if (!msg || typeof msg.method !== 'string') continue; // a response to us; we send no requests
    const p = handle(tools, info, msg)
      .then((out) => {
        if (out) output.write(JSON.stringify(out) + '\n');
      })
      .catch((e: unknown) => {
        log.write(`design mcp: ${(e as Error).message}\n`);
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}
