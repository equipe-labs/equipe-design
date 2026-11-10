import type { BrowserContext, Request } from 'playwright-core';

// Only GET and HEAD leave the browser. Everything else (POST, PUT, PATCH, DELETE…) is
// aborted, so reading a page never submits, logs or changes anything. WebSockets never reach
// the server either: what a page sends over one can't be told apart from an action.
// A crawl adds `deny`: GETs that act (a /logout link, ?action=delete) are aborted too.

export type DenyRule = (req: { url: string; method: string; resourceType: string; isNavigation: boolean }) => string | null;

export interface RouteGuard {
  blocked: () => number;
  /** What was aborted and why (crawl results list them). */
  log: { url: string; method: string; reason: string }[];
  /** Counts of WebSockets that were kept from connecting. */
  sockets: () => number;
}

export async function blockMutatingRequests(context: BrowserContext, deny?: DenyRule): Promise<RouteGuard> {
  let blocked = 0;
  let sockets = 0;
  const log: RouteGuard['log'] = [];
  await context.route('**/*', (route) => {
    const r: Request = route.request();
    const m = r.method();
    const reason =
      m === 'GET' || m === 'HEAD'
        ? (deny?.({ url: r.url(), method: m, resourceType: r.resourceType(), isNavigation: r.isNavigationRequest() }) ?? null)
        : `${m} 요청`;
    if (!reason) return route.continue();
    blocked++;
    if (log.length < 500) log.push({ url: r.url(), method: m, reason });
    return route.abort('blockedbyclient');
  });
  // A WebSocket handled here without connectToServer() never opens to the server.
  await context.routeWebSocket(/.*/, () => {
    sockets++;
  });
  return { blocked: () => blocked, log, sockets: () => sockets };
}
