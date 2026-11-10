import type { SweepElement, SweepResult } from '../capture/inpage.ts';
import type { Catalog, CatalogEntry, Cue } from './types.ts';
import type { ProbeNode } from './probe.ts';

// Finding catalog components on one page: a cue (role/tag/slot/attribute) per entry, plus a
// few structural matchers for components with no ARIA role or tag of their own (badge,
// card, avatar…). An element is claimed by the entry whose matching cue is the most specific.

export type DetectedBy = 'role' | 'tag' | 'slot' | 'attrs' | 'hint' | 'structure';

export interface Hit {
  entry: string;
  path: string;
  by: DetectedBy[];
  /** Specificity of the winning match; used to settle two entries claiming one element. */
  score: number;
}

export interface PageIndex {
  sweep: SweepResult;
  byPath: Map<string, SweepElement>;
  probe: Map<string, ProbeNode>;
  /** path -> descendant counts by role (and `tag:x`), over visible elements. */
  below: Map<string, Map<string, number>>;
  children: Map<string, string[]>;
  docWidth: number;
  viewportHeight: number;
}

export const parentOf = (path: string): string | null => {
  if (path === '') return null;
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

export function indexPage(sweep: SweepResult, nodes: ProbeNode[], viewportHeight = 900): PageIndex {
  const byPath = new Map<string, SweepElement>();
  const children = new Map<string, string[]>();
  const below = new Map<string, Map<string, number>>();
  for (const e of sweep.elements) {
    byPath.set(e.path, e);
    const p = parentOf(e.path);
    if (p !== null) (children.get(p) ?? children.set(p, []).get(p)!).push(e.path);
  }
  const bump = (path: string, key: string) => {
    let m = below.get(path);
    if (!m) below.set(path, (m = new Map()));
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  for (const e of sweep.elements) {
    if (e.decor && e.tag !== 'svg') continue;
    for (let a = parentOf(e.path); a !== null; a = parentOf(a)) {
      if (e.role) bump(a, e.role);
      bump(a, 'tag:' + e.tag);
      if (a === '') break;
    }
  }
  return { sweep, byPath, probe: new Map(nodes.map((n) => [n.path, n])), below, children, docWidth: sweep.doc.width, viewportHeight };
}

const attrOf = (px: PageIndex, el: SweepElement, name: string): string | undefined => {
  const n = px.probe.get(el.path);
  if (name === 'type') return n?.inputType;
  if (name === 'disabled' && el.disabled) return 'true';
  return n?.attrs?.[name];
};

function ancestorMatches(px: PageIndex, el: SweepElement, cue: Cue, depth = 8): boolean {
  let p = parentOf(el.path);
  for (let d = 0; p !== null && d < depth; d++, p = parentOf(p)) {
    const a = px.byPath.get(p);
    if (a && cueMatches(px, a, cue, false)) return true;
    if (p === '') break;
  }
  return false;
}

/** Whether every given field of the cue matches. */
export function cueMatches(px: PageIndex, el: SweepElement, cue: Cue, useInside = true): boolean {
  const n = px.probe.get(el.path);
  if (cue.tag && !cue.tag.includes(el.tag)) return false;
  if (cue.role && !(el.role && cue.role.includes(el.role))) return false;
  if (cue.slot && !(n?.slot && cue.slot.includes(n.slot))) return false;
  if (cue.inputType && !(n?.inputType && cue.inputType.includes(n.inputType))) return false;
  if (cue.hint && !cue.hint.some((h) => n?.hints?.includes(h))) return false;
  if (cue.attrs) {
    for (const [k, v] of Object.entries(cue.attrs)) {
      const got = attrOf(px, el, k);
      if (v === true ? got === undefined : got !== String(v).toLowerCase()) return false;
    }
  }
  if (useInside && cue.inside && !ancestorMatches(px, el, cue.inside)) return false;
  return true;
}

export function cueScore(cue: Cue): number {
  return (cue.slot ? 4 : 0) + (cue.role ? 2 : 0) + (cue.attrs ? 3 * Object.keys(cue.attrs).length : 0) + (cue.tag ? 1 : 0) + (cue.inputType ? 2 : 0) + (cue.inside ? 2 : 0) + (cue.hint ? 0.5 : 0);
}

export function cueKinds(cue: Cue): DetectedBy[] {
  const k: DetectedBy[] = [];
  if (cue.role) k.push('role');
  if (cue.tag) k.push('tag');
  if (cue.slot) k.push('slot');
  if (cue.attrs || cue.inputType) k.push('attrs');
  if (cue.hint) k.push('hint');
  return k;
}

// ---------------------------------------------------------------- structural matchers

const opaque = (px: PageIndex, i: number) => i >= 0 && px.sweep.colors[i]![3] >= 0.05;
/** A visible border: a width and a colour that is not transparent (Tailwind's `border-transparent` is not one). */
const hasBorder = (e: SweepElement) => e.borderWidth.some((w, i) => w > 0 && e.border[i]! >= 0);
const hasSurface = (px: PageIndex, e: SweepElement) => opaque(px, e.bg) || hasBorder(e);
const maxRadius = (e: SweepElement) => Math.max(...e.radius);
const hint = (px: PageIndex, e: SweepElement, ...words: string[]) => words.some((w) => px.probe.get(e.path)?.hints?.includes(w));
const countBelow = (px: PageIndex, e: SweepElement, key: string) => px.below.get(e.path)?.get(key) ?? 0;
const childEls = (px: PageIndex, e: SweepElement) => (px.children.get(e.path) ?? []).map((p) => px.byPath.get(p)!).filter(Boolean);
const INLINE_TAGS = new Set(['span', 'div', 'a', 'small', 'p', 'li']);

type Structural = (px: PageIndex, e: SweepElement) => boolean;

export const STRUCTURES: Record<string, Structural> = {
  // Small text pill: not a control of its own (or a link), one line, rounded, filled or outlined.
  badge: (px, e) =>
    INLINE_TAGS.has(e.tag) && e.text && !e.decor && e.rect[3] >= 14 && e.rect[3] <= 34 && e.rect[2] <= 220 && e.fontSize <= 15 && e.padding[3] >= 4 && e.padding[3] <= 20 &&
    (maxRadius(e) >= 4 || hint(px, e, 'badge', 'chip', 'pill')) && hasSurface(px, e) && e.childCount <= 3 && (!e.interactive || e.role === 'link' || e.tag === 'a') && e.rect[2] > e.rect[3] * 1.2,
  // A raised/outlined box with padding that holds several things.
  card: (px, e) => {
    if (e.interactive || e.tag === 'body' || e.tag === 'html' || e.tag === 'table' || (e.tag === 'li' && e.rect[3] < 40)) return false;
    if (!hasSurface(px, e) || maxRadius(e) <= 0 || Math.min(e.padding[0], e.padding[3]) < 12) return false;
    if (e.rect[2] * e.rect[3] < 12_000 || e.rect[2] >= px.docWidth * 0.98) return false;
    return e.childCount >= 2 || hint(px, e, 'card');
  },
  avatar: (px, e) => {
    const r = e.rect;
    if (e.interactive && e.role !== 'link' && e.role !== 'button') return false;
    if (r[2] < 20 || r[2] > 112 || Math.abs(r[2] - r[3]) > 2) return false;
    if (maxRadius(e) < Math.min(r[2], r[3]) / 2 - 1 && !hint(px, e, 'avatar')) return false;
    const n = px.probe.get(e.path);
    return !!n?.img || hint(px, e, 'avatar') || (e.text && e.rect[2] <= 64 && hasSurface(px, e));
  },
  skeleton: (px, e) => !e.decor && e.childCount === 0 && !e.text && hint(px, e, 'skeleton', 'pulse') && opaque(px, e.bg),
  spinner: (px, e) => e.rect[2] <= 64 && Math.abs(e.rect[2] - e.rect[3]) <= 2 && (e.tag === 'svg' || e.childCount > 0) && hint(px, e, 'spinner', 'spin'),
  'aspect-ratio': () => false,
  breadcrumb: (px, e) => (e.tag === 'nav' || e.role === 'navigation' || e.tag === 'ol') && (px.probe.get(e.path)?.attrs?.['aria-label'] === 'breadcrumb' || hint(px, e, 'breadcrumb')),
  pagination: (px, e) => (e.tag === 'nav' || e.role === 'navigation' || e.role === 'group' || e.tag === 'ul') && (px.probe.get(e.path)?.attrs?.['aria-label'] === 'pagination' || hint(px, e, 'pagination')),
  // A label plus a control that belong together.
  field: (px, e) => {
    if (e.interactive || e.childCount < 2 || e.childCount > 6 || e.rect[3] > 260) return false;
    const kids = childEls(px, e);
    const label = kids.some((k) => k.tag === 'label' || px.probe.get(k.path)?.labelled);
    const ctl = countBelow(px, e, 'textbox') + countBelow(px, e, 'combobox') + countBelow(px, e, 'checkbox') + countBelow(px, e, 'switch') + countBelow(px, e, 'radio') + countBelow(px, e, 'slider');
    return (label && ctl >= 1 && ctl <= 2) || (hint(px, e, 'field') && ctl >= 1);
  },
  empty: () => false,
  item: () => false,
  // One bordered, rounded box around an input and an addon (button or icon) that carry no border of their own.
  'input-group': (px, e) => {
    if (e.interactive || e.childCount < 2 || e.childCount > 5 || !hasBorder(e) || maxRadius(e) <= 0) return false;
    const kids = childEls(px, e);
    const input = kids.find((k) => k.role === 'textbox' || k.role === 'searchbox' || k.role === 'combobox');
    if (!input || hasBorder(input)) return false;
    return kids.some((k) => k !== input && (k.role === 'button' || k.tag === 'svg' || k.text));
  },
  // Adjacent buttons that share edges: inner corners squared off.
  'button-group': (px, e) => {
    if (e.interactive || e.childCount < 2 || e.childCount > 8) return false;
    const kids = childEls(px, e).filter((k) => k.role === 'button' || (k.role === 'link' && hasSurface(px, k)));
    if (kids.length < 2 || kids.length < e.childCount) return false;
    const first = kids[0]!;
    const last = kids[kids.length - 1]!;
    // radius = [tl, tr, br, bl]
    return first.radius[0] > 0 && first.radius[1] < 1 && last.radius[0] < 1 && last.radius[1] > 0 && e.gap[1] < 2;
  },
  'toggle-group': (px, e) => {
    if (e.interactive) return false;
    const kids = childEls(px, e);
    const pressed = kids.filter((k) => px.probe.get(k.path)?.attrs?.['aria-pressed'] !== undefined || px.probe.get(k.path)?.attrs?.['aria-checked'] !== undefined);
    return pressed.length >= 2 && pressed.length === kids.length;
  },
  sidebar: (px, e) => {
    if (!(e.tag === 'aside' || e.tag === 'nav' || e.role === 'complementary' || e.role === 'navigation' || hint(px, e, 'sidebar'))) return false;
    const nearEdge = e.rect[0] <= 8 || e.rect[0] + e.rect[2] >= px.docWidth - 8;
    return e.rect[2] >= 160 && e.rect[2] <= 380 && e.rect[3] >= px.viewportHeight * 0.6 && nearEdge && countBelow(px, e, 'link') + countBelow(px, e, 'button') >= 4;
  },
  'navigation-menu': (px, e) => (e.tag === 'nav' || e.role === 'navigation') && e.rect[1] < 220 && e.rect[2] > e.rect[3] * 3 && countBelow(px, e, 'link') + countBelow(px, e, 'button') >= 3 && !hint(px, e, 'breadcrumb', 'pagination'),
  'data-table': (px, e) => (e.tag === 'table' || e.role === 'grid' || e.role === 'table') && countBelow(px, e, 'tag:tr') >= 3 && countBelow(px, e, 'checkbox') + countBelow(px, e, 'button') >= 2,
  typography: (px, e) => ['h1', 'h2', 'h3', 'h4', 'blockquote'].includes(e.tag) || (e.tag === 'code' && px.byPath.get(parentOf(e.path) ?? '')?.tag !== 'pre') || (e.tag === 'p' && e.fontSize >= 18 && e.fontWeight <= 400),
  chart: (px, e) => (e.tag === 'svg' && e.rect[2] >= 150 && e.rect[3] >= 80 && !e.decor && (hint(px, e, 'chart', 'recharts') || countBelow(px, e, 'tag:path') + countBelow(px, e, 'tag:rect') >= 8)) || (hint(px, e, 'recharts') && e.rect[2] >= 150),
  calendar: (px, e) => (e.role === 'grid' || e.tag === 'table' || hint(px, e, 'calendar', 'rdp')) && countBelow(px, e, 'gridcell') + countBelow(px, e, 'tag:td') >= 28,
  'date-picker': (px, e) => e.role === 'dialog' && countBelow(px, e, 'gridcell') >= 28,
  form: (px, e) => e.tag === 'form' && countBelow(px, e, 'textbox') + countBelow(px, e, 'combobox') + countBelow(px, e, 'checkbox') >= 1,
  label: (_px, e) => e.tag === 'label',
};

// ---------------------------------------------------------------- matching

export function findHits(catalog: Catalog, px: PageIndex): Hit[] {
  const best = new Map<string, Hit>();
  for (const e of px.sweep.elements) {
    if (e.banner || e.tag === 'html' || e.tag === 'body') continue;
    for (const entry of catalog.components) {
      const m = matchEntry(px, e, entry);
      if (!m) continue;
      const prev = best.get(e.path);
      if (!prev || m.score > prev.score) best.set(e.path, { entry: entry.name, path: e.path, by: m.by, score: m.score });
    }
  }
  // A nested element of the same component is a part of it, not another instance.
  const hits = [...best.values()];
  const byEntry = new Map<string, Set<string>>();
  for (const h of hits) (byEntry.get(h.entry) ?? byEntry.set(h.entry, new Set()).get(h.entry)!).add(h.path);
  return hits.filter((h) => {
    const set = byEntry.get(h.entry)!;
    for (let a = parentOf(h.path); a !== null; a = parentOf(a)) {
      if (set.has(a)) return false;
      if (a === '') break;
    }
    return true;
  });
}

function matchEntry(px: PageIndex, e: SweepElement, entry: CatalogEntry): { by: DetectedBy[]; score: number } | null {
  let best: { by: DetectedBy[]; score: number } | null = null;
  for (const cue of entry.cues) {
    if (e.decor && !cue.tag?.includes('svg') && !cue.slot) continue;
    if (!cueMatches(px, e, cue)) continue;
    const score = cueScore(cue);
    if (!best || score > best.score) best = { by: cueKinds(cue), score };
  }
  if (!best && entry.structure && !e.decor) {
    const fn = STRUCTURES[entry.structure];
    if (fn?.(px, e)) best = { by: ['structure'], score: 1.5 };
  }
  return best;
}
