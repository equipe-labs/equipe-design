import type { Extraction } from './types.ts';

// Ids are only meaningful inside one result: every `c*`, `t*` and `L*` that a value
// points at must be declared in the same file.

export interface ReferenceError {
  path: string;
  id: string;
}

const COLOR_REF = /\bc[0-9]+\b/g;

export function findDanglingReferences(x: Extraction): ReferenceError[] {
  const colors = new Set(x.observed.color.map((c) => c.id));
  const styles = new Set(x.observed.typography.styles.map((s) => s.id));
  const limits = new Set(x.limits.map((l) => l.id));
  const out: ReferenceError[] = [];

  const walk = (v: unknown, path: string, key: string) => {
    if (typeof v === 'string') {
      if (key === 'limit' && !limits.has(v)) out.push({ path, id: v });
      if (/^t[0-9]+$/.test(v) && (key === 'style' || key === 'typeStyle') && !styles.has(v)) out.push({ path, id: v });
      if (path.startsWith('/inferred') || path.includes('/resolvesTo/')) {
        for (const id of v.match(COLOR_REF) ?? []) if (!colors.has(id)) out.push({ path, id });
      }
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}/${i}`, key));
    } else if (v && typeof v === 'object') {
      for (const [k, item] of Object.entries(v)) {
        if (k === 'reasons' || k === 'suggestedName' || k === 'id') continue;
        walk(item, `${path}/${k}`, k);
      }
    }
  };
  walk(x.inferred, '/inferred', '');
  walk(x.observed.variables, '/observed/variables', '');
  walk(x.source, '/source', '');
  return out;
}
