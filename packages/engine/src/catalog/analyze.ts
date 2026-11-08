import type { Rgba, StateProps, SweepElement, SweepResult } from '../capture/inpage.ts';
import { colorKey, round } from '../analyze/color.ts';
import { cueMatches, findHits, indexPage, type DetectedBy, type PageIndex } from './match.ts';
import type { ProbeNode } from './probe.ts';
import type { Catalog, CatalogEntry, Cue } from './types.ts';

// Per page: find the catalog's components, group each by look (variants), and keep the raw
// values (colours as numbers, lengths in px) for the build step (build.ts) to tie to tokens.
// Everything here is JSON-able: the crawl writes it with the page (styles.json) and a later
// step can merge many screens.

export interface RawProps {
  bg: Rgba | null;
  fg: Rgba | null;
  border: Rgba | null;
  borderWidth: number;
  /** px; 9999 = a full pill/circle. */
  radius: number | null;
  paddingX: number;
  paddingY: number;
  height: number;
  width: number;
  gap: number;
  shadow: string;
  opacity: number;
  /** Path of the element whose text style stands for the component (for typeStyle). */
  textPath: string | null;
}

export interface RawEvidence {
  sel: string;
  role: string | null;
  rect: [number, number, number, number];
}

export interface RawExample {
  count: number;
  props: RawProps;
  evidence: RawEvidence[];
}

export interface RawGroup {
  key: string;
  count: number;
  dataVariant?: string;
  heights: number[];
  props: RawProps;
  structure: { icon: 'leading' | 'trailing' | 'only' | 'both' | null; label: 'start' | 'center' | 'end' | null; parts: string[] };
  /** Paths to force :hover / :focus-visible / :active on. */
  reps: string[];
  evidence: RawEvidence[];
  /** State examples found on the page (checked, open, disabled…), keyed by state name. */
  states: Record<string, RawExample>;
}

export interface RawEntry {
  name: string;
  instances: number;
  by: DetectedBy[];
  groups: RawGroup[];
  parts: Record<string, number>;
}

export interface PageCatalog {
  entries: RawEntry[];
  /** Forced-state reads for the reps of every group, by path. */
  forced: Record<string, Partial<Record<'default' | 'hover' | 'focus-visible' | 'active', StateProps>>>;
}

const FORCED = new Set(['default', 'hover', 'focus-visible', 'active']);
/** States that are the component's resting look: elements in them are the default look, and are also kept as examples of the state. */
const RESTING = new Set(['unchecked', 'off', 'closed', 'collapsed']);
const MAX_GROUPS = 8;

function descendants(px: PageIndex, path: string, max = 240): SweepElement[] {
  const out: SweepElement[] = [];
  const queue = [...(px.children.get(path) ?? [])];
  while (queue.length && out.length < max) {
    const p = queue.shift()!;
    const e = px.byPath.get(p);
    if (e) out.push(e);
    queue.push(...(px.children.get(p) ?? []));
  }
  return out;
}

function textElement(px: PageIndex, el: SweepElement): SweepElement | null {
  if (el.text) return el;
  return descendants(px, el.path, 60).find((d) => d.text && !d.decor) ?? null;
}

function rawProps(px: PageIndex, el: SweepElement): RawProps {
  const col = (i: number) => (i >= 0 ? px.sweep.colors[i]! : null);
  const t = textElement(px, el);
  const bg = col(el.bg);
  const r = Math.max(...el.radius);
  const full = r >= Math.min(el.rect[2], el.rect[3]) / 2 - 0.5;
  const bi = el.border.find((b) => b >= 0) ?? -1;
  return {
    bg: bg && bg[3] >= 0.05 ? bg : null,
    fg: col((t ?? el).fg),
    border: bi >= 0 ? col(bi) : null,
    borderWidth: bi >= 0 ? Math.max(...el.borderWidth) : 0,
    radius: r > 0 ? (full ? 9999 : round(r, 1)) : null,
    paddingX: round((el.padding[1] + el.padding[3]) / 2, 1),
    paddingY: round((el.padding[0] + el.padding[2]) / 2, 1),
    height: Math.round(el.rect[3]),
    width: Math.round(el.rect[2]),
    gap: Math.max(...el.gap),
    shadow: el.shadow,
    opacity: el.opacity,
    textPath: t?.path ?? null,
  };
}

function structureOf(px: PageIndex, el: SweepElement, entry: CatalogEntry): RawGroup['structure'] {
  const kids = descendants(px, el.path, 120);
  const icons = kids.filter((k) => k.tag === 'svg' || k.tag === 'img').filter((k) => k.rect[2] <= Math.max(64, el.rect[2] * 0.4));
  const t = textElement(px, el);
  let icon: RawGroup['structure']['icon'] = null;
  if (icons.length) {
    if (!t) icon = 'only';
    else {
      const tc = t.rect[0] + t.rect[2] / 2;
      const left = icons.some((i) => i.rect[0] + i.rect[2] / 2 < tc);
      const right = icons.some((i) => i.rect[0] + i.rect[2] / 2 > tc);
      icon = left && right ? 'both' : left ? 'leading' : right ? 'trailing' : 'leading';
    }
  }
  let label: RawGroup['structure']['label'] = null;
  if (t) {
    const dx = t.rect[0] + t.rect[2] / 2 - (el.rect[0] + el.rect[2] / 2);
    label = Math.abs(dx) <= Math.max(4, el.rect[2] * 0.04) ? 'center' : dx < 0 ? 'start' : 'end';
  }
  const parts: string[] = [];
  for (const part of entry.parts ?? []) {
    if (parts.includes(part.name)) continue;
    if (kids.some((k) => cueMatches(px, k, part.cue))) parts.push(part.name);
  }
  return { icon, label, parts };
}

/** State of an on-page example (checked, open, disabled…) by the entry's state cues, or null for a plain element. */
function stateOf(px: PageIndex, el: SweepElement, entry: CatalogEntry, resting = false): string | null {
  for (const s of entry.states) {
    if (FORCED.has(s) || RESTING.has(s) !== resting) continue;
    const cue: Cue | undefined = entry.stateCues?.[s];
    if (cue ? cueMatches(px, el, cue) : s === 'disabled' && el.disabled) return s;
  }
  return null;
}

const keyOf = (p: RawProps, dv: string | undefined) => [dv ?? '', p.bg && colorKey(p.bg), p.fg && colorKey(p.fg), p.border && colorKey(p.border), p.radius].join('|');

const evidenceOf = (el: SweepElement): RawEvidence => ({ sel: el.sel, role: el.role, rect: el.rect });

const dist = (a: RawProps, b: RawProps) => Math.abs(a.height - b.height) + Math.abs((a.radius ?? 0) - (b.radius ?? 0)) * 2 + Math.abs(a.paddingX - b.paddingX);

export function mostCommon(xs: number[]): number | null {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

export function detectPage(catalog: Catalog, sweep: SweepResult, nodes: ProbeNode[], viewportHeight = 900): PageCatalog {
  const px = indexPage(sweep, nodes, viewportHeight);
  const hits = findHits(catalog, px);
  const byEntry = new Map<string, typeof hits>();
  for (const h of hits) (byEntry.get(h.entry) ?? byEntry.set(h.entry, []).get(h.entry)!).push(h);
  const entries: RawEntry[] = [];
  for (const entry of catalog.components) {
    const list = byEntry.get(entry.name);
    if (!list?.length) continue;
    const els = list.map((h) => px.byPath.get(h.path)!).filter(Boolean);
    const plain: SweepElement[] = [];
    const stated: { el: SweepElement; state: string }[] = [];
    for (const el of els) {
      const st = stateOf(px, el, entry);
      if (st) stated.push({ el, state: st });
      else plain.push(el);
    }
    const rests: { el: SweepElement; state: string }[] = [];
    for (const el of plain) {
      const st = stateOf(px, el, entry, true);
      if (st) rests.push({ el, state: st });
    }
    // A page where every instance is in a state (all checkboxes checked) still has a default look.
    const base = plain.length ? plain : stated.map((s) => s.el);
    const groups = new Map<string, { els: SweepElement[]; props: Map<SweepElement, RawProps>; dv?: string }>();
    for (const el of base) {
      const p = rawProps(px, el);
      const dv = px.probe.get(el.path)?.attrs?.['data-variant'];
      const k = keyOf(p, dv);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { els: [], props: new Map(), ...(dv ? { dv } : {}) }));
      g.els.push(el);
      g.props.set(el, p);
    }
    const ranked = [...groups.entries()].sort((a, b) => b[1].els.length - a[1].els.length).slice(0, MAX_GROUPS);
    const raw: RawGroup[] = ranked.map(([key, g]) => {
      const heights = g.els.map((e) => Math.round(e.rect[3] / 2) * 2);
      const modal = mostCommon(heights);
      const rep = g.els.find((e) => Math.round(e.rect[3] / 2) * 2 === modal) ?? g.els[0]!;
      return {
        key,
        count: g.els.length,
        ...(g.dv ? { dataVariant: g.dv } : {}),
        heights,
        props: g.props.get(rep)!,
        structure: structureOf(px, rep, entry),
        reps: [rep.path, ...g.els.filter((e) => e !== rep).slice(0, 1).map((e) => e.path)],
        evidence: g.els.slice(0, 3).map(evidenceOf),
        states: {},
      };
    });
    // State examples go to the variant whose geometry is closest.
    if (plain.length) {
      for (const { el, state } of [...stated, ...rests]) {
        const p = rawProps(px, el);
        const g = [...raw].sort((a, b) => dist(a.props, p) - dist(b.props, p) || b.count - a.count)[0];
        if (!g) continue;
        const ex = (g.states[state] ??= { count: 0, props: p, evidence: [] });
        ex.count++;
        if (ex.evidence.length < 3) ex.evidence.push(evidenceOf(el));
      }
    }
    const parts: Record<string, number> = {};
    for (const g of raw) for (const part of g.structure.parts) parts[part] = (parts[part] ?? 0) + g.count;
    entries.push({ name: entry.name, instances: list.length, by: [...new Set(list.flatMap((h) => h.by))], groups: raw, parts });
  }
  return { entries, forced: {} };
}

/** Paths to force :hover / :focus-visible / :active on, at most `cap`: the first example of every look, then the second, skipping looks already read on an earlier page. */
export function forcePaths(pc: PageCatalog, cap: number, seen: Set<string>): string[] {
  const out: string[] = [];
  const groups = pc.entries.flatMap((e) => e.groups.map((g) => ({ k: `${e.name}|${g.key}`, g }))).filter(({ k }) => !seen.has(k));
  for (const { k } of groups) seen.add(k);
  for (const i of [0, 1]) for (const { g } of groups) if (g.reps[i] && out.length < cap) out.push(g.reps[i]!);
  return out;
}
