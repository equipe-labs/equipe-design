// robots.txt, read before the first page request (RFC 9309).
//
// - Groups: the one whose user-agent line matches our product token ("equipe-design")
//   wins; otherwise `*`. Several groups for the same agent are merged.
// - Rules: the longest matching path wins; on a tie Allow wins. `*` and `$` are supported.
// - 4xx (no robots.txt) → everything allowed. 5xx or unreachable → everything disallowed
//   (RFC 9309 2.3.1.4), except on localhost / 127.0.0.1, where an unreachable robots.txt
//   is treated as "exempt" so a local dev server without one can be read. A robots.txt
//   that exists is obeyed everywhere, local hosts included. There is no option to skip it.

export const PRODUCT_TOKEN = 'equipe-design';

export interface RobotsRule {
  allow: boolean;
  path: string;
}

export interface RobotsDecision {
  checked: boolean;
  allowed: boolean;
  /** The matching rule, e.g. 'Disallow: /app/'; null when no rule matched. */
  rule: string | null;
  /** 'exempt' when robots.txt could not be read on a local host. */
  verdict: 'allowed' | 'disallowed' | 'exempt';
  /** Human-readable reason (Korean, goes into limits). */
  note?: string;
}

export function parseRobots(text: string, token = PRODUCT_TOKEN): RobotsRule[] {
  type Group = { agents: string[]; rules: RobotsRule[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "nothing is disallowed": no rule.
      if (key === 'disallow' && value === '') continue;
      current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const t = token.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && (a === t || t.startsWith(a) || a.startsWith(t))));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

export function sitemapLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** Percent-encoding is normalised the same way on both sides before matching. */
function normalisePath(p: string): string {
  try {
    return encodeURI(decodeURI(p));
  } catch {
    return p;
  }
}

export function matchRobots(rules: RobotsRule[], pathAndQuery: string): { allowed: boolean; rule: RobotsRule | null } {
  const target = normalisePath(pathAndQuery);
  if (target === '/robots.txt') return { allowed: true, rule: null };
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!r.path) continue;
    if (!patternToRegExp(normalisePath(r.path)).test(target)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return { allowed: best ? best.allow : true, rule: best };
}

export const isLocalHost = (u: URL) => u.protocol === 'file:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';

const ruleText = (r: RobotsRule) => `${r.allow ? 'Allow' : 'Disallow'}: ${r.path}`;

/** Fetches /robots.txt once per origin and decides for each URL. */
export class RobotsGuard {
  private cache = new Map<string, Promise<{ rules: RobotsRule[] | 'all' | 'none' | 'exempt'; note?: string; sitemaps?: string[] }>>();
  private userAgent: string;
  private fetchImpl: typeof fetch;
  constructor(userAgent: string, fetchImpl: typeof fetch = fetch) {
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
  }

  private load(origin: URL) {
    const key = origin.origin;
    let p = this.cache.get(key);
    if (!p) {
      p = (async () => {
        const local = isLocalHost(origin);
        try {
          const res = await this.fetchImpl(new URL('/robots.txt', origin), {
            headers: { 'user-agent': this.userAgent },
            redirect: 'follow',
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status >= 200 && res.status < 300) {
            const text = await res.text();
            return { rules: parseRobots(text), sitemaps: sitemapLines(text) };
          }
          if (res.status >= 400 && res.status < 500) return { rules: 'all' as const, note: `robots.txt 없음(HTTP ${res.status}) — 전부 허용으로 봄` };
          if (local) return { rules: 'exempt' as const, note: `로컬 주소의 robots.txt가 HTTP ${res.status} — 로컬 예외` };
          return { rules: 'none' as const, note: `robots.txt가 HTTP ${res.status} — RFC 9309에 따라 전부 막힘으로 봄` };
        } catch {
          if (local) return { rules: 'exempt' as const, note: '로컬 주소의 robots.txt를 읽지 못함 — 로컬 예외' };
          return { rules: 'none' as const, note: 'robots.txt에 닿지 못함 — RFC 9309에 따라 전부 막힘으로 봄' };
        }
      })();
      this.cache.set(key, p);
    }
    return p;
  }

  /** The `Sitemap:` URLs robots.txt names (any group; they are not agent-specific). */
  async sitemaps(url: URL): Promise<string[]> {
    if (url.protocol === 'file:') return [];
    return (await this.load(url)).sitemaps ?? [];
  }

  async check(url: URL): Promise<RobotsDecision> {
    if (url.protocol === 'file:') return { checked: false, allowed: true, rule: null, verdict: 'exempt', note: 'file: 주소는 robots.txt가 없음' };
    const { rules, note } = await this.load(url);
    if (rules === 'all') return { checked: true, allowed: true, rule: null, verdict: 'allowed', note };
    if (rules === 'exempt') return { checked: true, allowed: true, rule: null, verdict: 'exempt', note };
    if (rules === 'none') return { checked: true, allowed: false, rule: null, verdict: 'disallowed', note };
    const { allowed, rule } = matchRobots(rules, url.pathname + url.search);
    return { checked: true, allowed, rule: rule ? ruleText(rule) : null, verdict: allowed ? 'allowed' : 'disallowed', note };
  }
}
