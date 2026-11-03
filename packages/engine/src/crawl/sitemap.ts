// Screens named by the site itself: robots.txt `Sitemap:` lines, else /sitemap.xml and
// /sitemap_index.xml. Sitemap indexes are followed (two levels, 50 files at most). Plain fetch
// with the engine's User-Agent; no session is sent (sitemaps are public).

export interface SitemapResult {
  urls: string[];
  files: string[];
  /** Sitemap files that could not be read, with why. */
  failed: { url: string; reason: string }[];
}

const MAX_FILES = 50;
const MAX_URLS = 50_000;

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = (tag: string) => {
    const out: string[] = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    for (const m of xml.matchAll(re)) {
      const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(m[1]!);
      if (loc) out.push(decodeXml(loc[1]!.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()));
    }
    return out;
  };
  return { urls: locs('url'), sitemaps: locs('sitemap') };
}

const decodeXml = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export async function readSitemaps(site: URL, fromRobots: string[], opts: { userAgent: string; fetch?: typeof fetch }): Promise<SitemapResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const result: SitemapResult = { urls: [], files: [], failed: [] };
  const queue: { url: string; depth: number }[] = (fromRobots.length ? fromRobots : [new URL('/sitemap.xml', site).href, new URL('/sitemap_index.xml', site).href]).map((url) => ({ url, depth: 0 }));
  const seen = new Set<string>();
  const quietMissing = !fromRobots.length;
  while (queue.length && result.files.length < MAX_FILES && result.urls.length < MAX_URLS) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    let u: URL;
    try {
      u = new URL(url, site);
    } catch {
      result.failed.push({ url, reason: '주소가 아님' });
      continue;
    }
    if (u.origin !== site.origin) {
      result.failed.push({ url, reason: '다른 출처의 사이트맵' });
      continue;
    }
    try {
      const res = await fetchImpl(u, { headers: { 'user-agent': opts.userAgent }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        if (!(quietMissing && res.status === 404)) result.failed.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      if (/\.gz$/i.test(u.pathname)) {
        result.failed.push({ url, reason: 'gzip 사이트맵은 읽지 않음' });
        continue;
      }
      const text = await res.text();
      if (!/<(urlset|sitemapindex)\b/i.test(text)) {
        // A login page or a 200 "not found" page in place of the sitemap.
        if (!quietMissing) result.failed.push({ url, reason: '사이트맵 XML이 아님' });
        continue;
      }
      result.files.push(u.href);
      const { urls, sitemaps } = parseSitemap(text);
      for (const x of urls) if (result.urls.length < MAX_URLS) result.urls.push(x);
      if (depth < 2) for (const s of sitemaps) queue.push({ url: s, depth: depth + 1 });
    } catch (e) {
      result.failed.push({ url, reason: String((e as Error).message).slice(0, 80) });
    }
  }
  return result;
}
