import { existsSync, readFileSync } from 'node:fs';
import type { Answer, SiteSpec } from './types.ts';

export const EVAL_DIR = new URL('../', import.meta.url);
export const STALE_DAYS = 30;

export function loadSites(): SiteSpec[] {
  const j = JSON.parse(readFileSync(new URL('sites.json', EVAL_DIR), 'utf8')) as { sites: SiteSpec[] };
  return j.sites;
}

export function answerPath(host: string): URL {
  return new URL(`answers/${host}.json`, EVAL_DIR);
}

export function loadAnswer(host: string): Answer | null {
  const p = answerPath(host);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Answer;
}

/** Problems with an answer file: missing `checkedAt`, a section without a source, a malformed colour. */
export function checkAnswer(a: Answer): string[] {
  const issues: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.checkedAt ?? '')) issues.push('checkedAt must be YYYY-MM-DD');
  if (!a.sources?.length) issues.push('sources is empty');
  for (const k of ['dark', 'colors', 'spacing', 'radius', 'typography', 'brand'] as const) {
    const s = a[k] as { source?: string } | undefined;
    if (s && !s.source) issues.push(`${k}.source is missing`);
  }
  for (const it of a.colors?.items ?? []) {
    for (const v of [it.light, it.dark]) {
      if (v !== null && v !== undefined && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) issues.push(`colors.${it.name}: "${v}" is not lowercase #rrggbb[aa]`);
    }
  }
  return issues;
}

export function staleDays(a: Answer, today = new Date()): number {
  return Math.floor((today.getTime() - Date.parse(`${a.checkedAt}T00:00:00Z`)) / 86_400_000);
}
