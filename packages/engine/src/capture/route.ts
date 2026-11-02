import type { BrowserContext } from 'playwright-core';

// Only GET and HEAD leave the browser. Everything else (POST, PUT, PATCH, DELETE…) is
// aborted, so reading a page never submits, logs or changes anything.
export async function blockMutatingRequests(context: BrowserContext): Promise<{ blocked: () => number }> {
  let blocked = 0;
  await context.route('**/*', (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD') return route.continue();
    blocked++;
    return route.abort('blockedbyclient');
  });
  return { blocked: () => blocked };
}
