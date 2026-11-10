// A stand-in for the library API: answers every public path from packages/api-contract/fixtures,
// and records each request so tests can check what was (and wasn't) called.
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const FIXTURES = fileURLToPath(new URL('../../api-contract/fixtures/public/', import.meta.url));
export const PREFIX = '/api/design/v1';

export interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  userAgent: string | undefined;
}

export interface FakeServer {
  url: string;
  seen: Seen[];
  /** Answer the next n requests with 503. */
  failNext(n: number): void;
  close(): Promise<void>;
}

const json = (file: string) => (existsSync(FIXTURES + file) ? readFileSync(FIXTURES + file, 'utf8') : null);
const error = (code: string, message: string) => JSON.stringify({ error: { code, message } });

export async function startFakeServer(): Promise<FakeServer> {
  const seen: Seen[] = [];
  let failing = 0;
  const server: Server = createServer((req: IncomingMessage, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    seen.push({ method: req.method ?? '', path: u.pathname, query: Object.fromEntries(u.searchParams), userAgent: req.headers['user-agent'] });
    const send = (status: number, body: string | null, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(body ?? '');
    };
    if (failing > 0) { failing--; return send(503, error('internal', 'try again')); }
    if (!u.pathname.startsWith(PREFIX)) return send(404, error('not_found', 'no such path'));
    const p = u.pathname.slice(PREFIX.length);
    let m: RegExpExecArray | null;
    if (req.method === 'POST' && p === '/remix') return send(200, json('remix.response.json'));
    if (req.method !== 'GET') return send(404, error('not_found', 'no such path'));
    if (p === '/styles') {
      const list = JSON.parse(json('styles.json')!) as { styles: { slug: string; tags: string[] }[]; total: number };
      const q = u.searchParams.get('q');
      const styles = q ? list.styles.filter((s) => s.slug.includes(q) || s.tags.some((t) => t.includes(q))) : list.styles;
      return send(200, JSON.stringify({ styles, total: styles.length }));
    }
    if (p === '/meta') return send(200, json('meta.json'));
    if ((m = /^\/styles\/([a-z0-9-]+)$/.exec(p))) {
      const body = json(`styles/${m[1]}.json`);
      return body ? send(200, body) : send(404, error('not_found', `no style "${m[1]}"`));
    }
    if ((m = /^\/styles\/([a-z0-9-]+)\/releases$/.exec(p))) {
      const body = json(`styles/${m[1]}/releases.json`);
      return body ? send(200, body) : send(404, error('not_found', `no style "${m[1]}"`));
    }
    if ((m = /^\/styles\/([a-z0-9-]+)\/tokens\/([a-z-]+)$/.exec(p))) {
      const body = json(`styles/${m[1]}.json`);
      if (!body) return send(404, error('not_found', `no style "${m[1]}"`));
      const id = (JSON.parse(body) as { release: { id: string } }).release.id;
      return send(302, null, { location: `${PREFIX}/releases/${id}/tokens/${m[2]}` });
    }
    if ((m = /^\/releases\/([0-9a-f-]+)\/tokens\/([a-z-]+)$/.exec(p))) {
      const body = json(`releases/${m[1]}/tokens/${m[2]}.json`);
      return body ? send(200, body, { 'cache-control': 'public, max-age=31536000, immutable' }) : send(404, error('not_found', 'no such release or format'));
    }
    return send(404, error('not_found', 'no such path'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${PREFIX}`,
    seen,
    failNext: (n) => { failing = n; },
    close: () => new Promise((r) => server.close(() => r())),
  };
}
