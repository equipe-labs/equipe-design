// A test client: starts `equipe-design mcp` as Claude Code would and speaks MCP to it.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../cli/bin/equipe-design.js', import.meta.url));

export class Client {
  private next = 1;
  private waiting = new Map<number, (m: Record<string, unknown>) => void>();
  readonly stderr: string[] = [];
  readonly child: ChildProcessWithoutNullStreams;
  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    createInterface({ input: child.stdout }).on('line', (line) => {
      const m = JSON.parse(line) as Record<string, unknown>;
      this.waiting.get(m.id as number)?.(m);
    });
    child.stderr.on('data', (d: Buffer) => this.stderr.push(d.toString()));
  }
  static start(env: NodeJS.ProcessEnv = {}, cwd?: string): Client {
    return new Client(spawn(process.execPath, [BIN, 'mcp'], { env: { ...process.env, ...env }, ...(cwd ? { cwd } : {}) }));
  }
  request(method: string, params?: object): Promise<Record<string, unknown>> {
    const id = this.next++;
    return new Promise((res) => {
      this.waiting.set(id, res);
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }
  notify(method: string): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  }
  async call(name: string, args: object): Promise<{ isError?: boolean; text: string; structured: Record<string, unknown> }> {
    const r = (await this.request('tools/call', { name, arguments: args })).result as { isError?: boolean; content: { text: string }[]; structuredContent: Record<string, unknown> };
    return { ...(r.isError ? { isError: true } : {}), text: r.content[0]!.text, structured: r.structuredContent };
  }
  async close(): Promise<number | null> {
    this.child.stdin.end();
    return new Promise((res) => this.child.on('exit', (code) => res(code)));
  }
}
