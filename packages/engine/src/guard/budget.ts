// Page budget: at most five URLs per run, all on the origin of the first one, no link
// following, one second between page loads, sixty seconds per page.

export const MAX_PAGES = 5;
export const PAGE_TIMEOUT_MS = 60_000;
export const DELAY_BETWEEN_PAGES_MS = 1_000;

export interface BudgetPlan {
  accepted: URL[];
  /** Dropped because there were more than MAX_PAGES. */
  overCap: string[];
  /** Dropped because they were on another origin than the first URL. */
  otherOrigin: string[];
  /** Not a URL we can read (not http/https/file). */
  invalid: string[];
}

export function planPages(inputs: string[], max = MAX_PAGES): BudgetPlan {
  const plan: BudgetPlan = { accepted: [], overCap: [], otherOrigin: [], invalid: [] };
  let origin: string | null = null;
  const seen = new Set<string>();
  for (const raw of inputs) {
    let u: URL;
    try {
      u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    } catch {
      plan.invalid.push(raw);
      continue;
    }
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) {
      plan.invalid.push(raw);
      continue;
    }
    u.hash = '';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    origin ??= u.origin;
    if (u.origin !== origin) {
      plan.otherOrigin.push(u.href);
      continue;
    }
    if (plan.accepted.length >= max) {
      plan.overCap.push(u.href);
      continue;
    }
    plan.accepted.push(u);
  }
  return plan;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
