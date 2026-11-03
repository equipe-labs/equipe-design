import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// A small signed-in app for crawl tests: a sidebar, lists and details of one shape, a settings
// form, a menu whose items act, and every kind of link a crawl must leave alone. Behind a cookie
// (sid=ok); without it every page redirects to /login. Every request is recorded.

export interface CrawlSite {
  url: string;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}

const STYLE = `<style>
:root { --bg: #fafaf9; --text: #18181b; --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg: #09090b; --text: #fafafa; --accent: #60a5fa; } }
body { background: var(--bg); color: var(--text); font: 15px/22px system-ui, sans-serif; margin: 0; display: flex; }
aside { width: 200px; padding: 16px; border-right: 1px solid #8884; } aside a { display: block; padding: 4px 0; color: var(--accent); }
main { padding: 24px; flex: 1; } .btn { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; }
[role=menu] { border: 1px solid #8886; border-radius: 8px; padding: 4px; background: var(--bg); position: absolute; }
[role=menu][hidden] { display: none; }
</style>`;

const SIDEBAR = `<aside><nav>
<a href="/">Home</a><a href="/projects">Projects</a><a href="/settings">Settings</a><a href="/docs">Docs</a>
<a href="/logout">Log out</a>
<a href="/bye">로그아웃</a>
<a href="/account/delete">Delete account</a>
<a href="/billing">Billing</a>
<a href="/team/invite">Invite people</a>
<a href="/projects/1" data-method="delete">Remove project 1</a>
<a href="/projects?action=delete&id=2">Bulk</a>
<a href="/files/report.pdf">Report</a>
<a href="https://other.example/">Elsewhere</a>
</nav></aside>`;

const page = (title: string, body: string, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${STYLE}</head><body>${SIDEBAR}<main>${body}</main>
<script>
// A page that tries to write on load: a POST, a beacon and a socket.
fetch('/track', { method: 'POST', body: 'x' }).catch(() => {});
navigator.sendBeacon && navigator.sendBeacon('/beacon', 'y');
try { new WebSocket(location.origin.replace('http', 'ws') + '/ws'); } catch (e) {}
const t = document.getElementById('menu-btn'), m = document.getElementById('menu');
if (t) t.addEventListener('click', () => { const open = m.hidden; m.hidden = !open; t.setAttribute('aria-expanded', String(open)); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m) { m.hidden = true; t.setAttribute('aria-expanded', 'false'); } });
</script>${extra}</body></html>`;

const HOME = page('Dashboard', `<h1>Dashboard</h1>
<button id="menu-btn" class="btn" type="button" aria-haspopup="menu" aria-expanded="false">Account</button>
<div id="menu" role="menu" hidden>
  <button type="button" role="menuitem" onclick="fetch('/api/delete', { method: 'POST' })">Delete workspace</button>
  <button type="button" role="menuitem" onclick="location.href='/logout'">Sign out</button>
  <a role="menuitem" href="/profile">Profile</a>
</div>
<button type="button" aria-haspopup="dialog" onclick="fetch('/api/delete-project')">Delete project</button>
<details><summary>What is this?</summary><p>A test app.</p></details>
<form method="post" action="/projects"><input name="name"><button>Create project</button></form>
<form method="get" action="/search"><input name="q"><button>Search</button></form>
<ul>${[1, 2, 3, 4, 5].map((i) => `<li><a href="/projects/${i}">Project ${i}</a></li>`).join('')}</ul>`);

const LIST = page('Projects', `<h1>Projects</h1><ul>${[1, 2, 3, 4, 5].map((i) => `<li><a href="/projects/${i}">Project ${i}</a></li>`).join('')}</ul>`);
const DETAIL = (i: string) => page(`Project ${i}`, `<h1>Project ${i}</h1><p>Details.</p><form method="post" action="/projects/${i}/star"><button class="btn">Star</button></form>`);
const SETTINGS = page('Settings', `<h1>Settings</h1><form method="post" action="/settings"><label>Name <input name="n" value="me"></label><button type="submit" class="btn">Save</button></form>`);
const DOCS = page('Docs', '<h1>Docs</h1><p>Help.</p>');
const PROFILE = page('Profile', '<h1>Profile</h1>');
const LOGIN = `<!doctype html><html><head><title>Sign in</title></head><body><form method="post"><input type="email"><input type="password"><button>Sign in</button></form></body></html>`;

export async function startCrawlSite(): Promise<CrawlSite> {
  const requests: CrawlSite['requests'] = [];
  let base = '';
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    requests.push({ method: req.method ?? 'GET', path: req.url ?? '/' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(204).end();
    if (path === '/robots.txt') return void res.writeHead(200, { 'content-type': 'text/plain' }).end(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
    if (path === '/sitemap.xml') {
      const locs = ['/', '/docs', '/projects/4'].map((p) => `<url><loc>${base}${p}</loc></url>`).join('');
      return void res.writeHead(200, { 'content-type': 'application/xml' }).end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`);
    }
    if (path === '/login') return void res.writeHead(200, { 'content-type': 'text/html' }).end(LOGIN);
    const signedIn = /(^|;\s*)sid=ok(;|$)/.test(req.headers.cookie ?? '');
    if (!signedIn) return void res.writeHead(302, { location: '/login' }).end();
    const html =
      path === '/' ? HOME
      : path === '/projects' ? LIST
      : /^\/projects\/\d+$/.test(path) ? DETAIL(path.split('/')[2]!)
      : path === '/settings' ? SETTINGS
      : path === '/docs' ? DOCS
      : path === '/profile' ? PROFILE
      : null;
    if (!html) return void res.writeHead(404, { 'content-type': 'text/html' }).end(page('Not found', '<h1>404</h1>'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, requests, close: () => new Promise((r) => server.close(() => r())) };
}
