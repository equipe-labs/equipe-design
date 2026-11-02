import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A tiny local site for guardrail tests. Every request is recorded so tests can check
// what the engine asked for (and what it didn't).

export interface TestSite {
  url: string;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}

const PAGE = (body: string, extraHead = '') => `<!doctype html><html><head><meta charset="utf-8"><title>t</title>
<style>
:root { --bg: #f6f5f1; --text: #15161a; --accent: #1d4ed8; --s-1: 4px; --s-2: 8px; --s-3: 16px; --r-1: 8px; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0c; --text: #efede7; --accent: #8fb0ff; } }
body { background: var(--bg); color: var(--text); font: 16px/24px system-ui, sans-serif; margin: 0; padding: var(--s-3); }
section { padding: var(--s-3); margin-bottom: var(--s-2); }
a { color: var(--accent); }
.btn { display: inline-block; background: var(--accent); color: #fff; padding: var(--s-2) var(--s-3); border-radius: var(--r-1); }
.btn:hover { background: #15161a; }
.card { border: 1px solid #0a0a0c24; border-radius: 12px; padding: 16px; margin: 8px; }
</style>${extraHead}</head><body>${body}</body></html>`;

const HOME = PAGE(`
<header><a href="/">Home</a> <a href="/a">A</a> <a href="/b">B</a></header>
<section><h1>Title</h1><p>Some text here for the page.</p><a class="btn" href="/go">Go</a> <a class="btn" href="/go2">Go 2</a></section>
<section><div class="card"><p>One</p></div><div class="card"><p>Two</p></div><div class="card"><p>Three</p></div></section>
<footer><p>Footer <a href="/c">C</a></p></footer>`);

const LOGIN = PAGE(`<form><label>Email <input type="email"></label><label>Password <input type="password"></label><button>Sign in</button></form>`);

const POSTING = PAGE(
  `<section><p>Page that tries to post on load.</p><a class="btn" href="/">Back</a></section>`,
  `<script>fetch('/collect', { method: 'POST', body: 'x' }).catch(() => {}); navigator.sendBeacon && navigator.sendBeacon('/beacon', 'y');</script>`,
);

export async function startSite(opts: { robots?: string | null } = {}): Promise<TestSite> {
  const requests: TestSite['requests'] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    requests.push({ method: req.method ?? 'GET', path });
    if (path === '/robots.txt') {
      if (opts.robots === null || opts.robots === undefined) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' }).end(opts.robots);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(204).end();
      return;
    }
    const html = path === '/login' ? LOGIN : path === '/post' ? POSTING : HOME;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
