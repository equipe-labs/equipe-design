import type { Limit } from '@equipe-design/schema';

/** Collects limits with stable ids (L1, L2…), one per kind + scope. */
export class Limits {
  readonly list: Limit[] = [];
  add(kind: Limit['kind'], scope: string, reason: string, effect: string, fix: string | null): string {
    const same = this.list.find((l) => l.kind === kind && l.scope === scope);
    if (same) return same.id;
    const id = `L${this.list.length + 1}`;
    this.list.push({ id, kind, scope, reason, effect, fix });
    return id;
  }
}
