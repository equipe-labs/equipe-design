import type {
  EvidenceSample,
  FontFamily,
  Mode,
  ObservedBreakpoint,
  ObservedColor,
  ObservedElevation,
  ObservedMotion,
  ObservedRadius,
  ObservedShadow,
  ObservedSpacing,
  ObservedVariable,
  TypeStyle,
} from '@equipe-design/schema';
import { findForbiddenContent } from '@equipe-design/schema';
import type { Rgba, SweepElement } from '../capture/inpage.ts';
import { colorKey, deltaE, rgbToOklch, round, toHex } from './color.ts';
import { elementKey, sampleKey, type PageData, type Sample } from './model.ts';

// Observation: turns sweeps into the `observed.*` lists. Deterministic; no guessing here.

export interface ColorRecord {
  id: string;
  mode: Mode;
  rgba: Rgba;
  keys: Set<string>;
  elements: Set<string>;
  uses: Record<'background' | 'text' | 'border' | 'fill' | 'outline', Set<string>>;
  sections: Set<string>;
  area: number;
  /** Box area of the non-link, non-decorative text elements in this colour (widest sweep). */
  textArea: number;
  interactive: Set<string>;
  /** Elements inside the home link at the top (the logo). */
  home: Set<string>;
  decorative: Set<string>;
  samples: Sample[];
  evidence: EvidenceSample[];
  mergedFrom: Set<string>;
  variables: Set<string>;
  widthsSeen: Map<string, Set<number>>;
  observed: ObservedColor;
}

export interface Observation {
  colors: ColorRecord[];
  /** mode -> sample key -> colour id (widest sweep). */
  assign: Record<Mode, Map<string, string>>;
  /** colour id lookup by rgba within a mode. */
  colorFor(mode: Mode, c: Rgba | null): string | null;
  /** adds a colour seen only in a variable or a forced state (count 0). */
  ensureColor(mode: Mode, c: Rgba, variable?: string): string;
  families: FontFamily[];
  styles: (TypeStyle & { keyset: Set<string> })[];
  styleOf: Map<string, string>;
  spacing: (ObservedSpacing & { sections: number })[];
  radius: (ObservedRadius & { sections: number })[];
  shadow: ObservedShadow[];
  motion: ObservedMotion[];
  elevation: ObservedElevation[];
  breakpoints: ObservedBreakpoint[];
  variables: ObservedVariable[];
  /** default-mode elements at the widest width, by element key. */
  elements: Map<string, { page: number; el: SweepElement; mode: Mode; width: number }>;
  primaryMode: Mode;
  pageBackground: Partial<Record<Mode, Rgba>>;
}

const COLOR_PROPS: [keyof SweepElement, ColorRecord['uses'] extends Record<infer K, unknown> ? K : never, string][] = [
  ['bg', 'background', 'background-color'],
  ['fg', 'text', 'color'],
  ['outline', 'outline', 'outline-color'],
  ['fill', 'fill', 'fill'],
  ['stroke', 'fill', 'stroke'],
];

const confidenceOf = (count: number, sections: number, consistency: number, source: number) =>
  round(Math.min(1, 0.4 * Math.max(Math.log(count + 1) / Math.log(50), Math.min(1, sections / 4)) + 0.3 * consistency + 0.3 * source), 2);

export { confidenceOf };

const firstFamily = (ff: string) => (ff.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
const GENERICS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'] as const;
const SYSTEM_FONTS = /^(system-ui|-apple-system|blinkmacsystemfont|sf pro( text| display)?|segoe ui|helvetica( neue)?|arial|roboto|ui-sans-serif|ui-monospace|menlo|monaco|consolas|courier( new)?|times( new roman)?|georgia)$/i;
const KNOWN_LICENSE: [RegExp, string][] = [
  [/^(inter|inter variable|inter display|geist|geist mono|geist sans|jetbrains mono|jetbrains mono variable|ibm plex( sans| mono| serif)?|fira (sans|code|mono)|source (sans|serif|code)( pro| 3| 4)?|noto (sans|serif)[\w ]*|pretendard( variable)?|manrope|poppins|montserrat|dm (sans|mono|serif)[\w ]*|space (grotesk|mono)|work sans|lato|open sans|nunito( sans)?|rubik|outfit|plus jakarta sans|figtree|onest|lexend[\w ]*|instrument (sans|serif)|bricolage grotesque|literata|merriweather|playfair display|libre[\w ]*|public sans|recursive)$/i, 'OFL-1.1 (known family)'],
  [/^(roboto( mono| flex| slab)?)$/i, 'Apache-2.0 (known family)'],
];

function licenseOf(name: string): string {
  for (const [re, l] of KNOWN_LICENSE) if (re.test(name)) return l;
  if (SYSTEM_FONTS.test(name)) return 'system font';
  return 'commercial-or-unknown';
}

function oflAlternatives(name: string, generic: string): string[] {
  if (!/commercial-or-unknown|system font/.test(licenseOf(name))) return [];
  if (generic === 'monospace' || /mono|code|courier|menlo|consolas/i.test(name)) return ['JetBrains Mono', 'IBM Plex Mono'];
  if (generic === 'serif' || /serif|times|georgia/i.test(name)) return ['Source Serif 4', 'Literata'];
  return ['Inter', 'Geist'];
}

const sanitize = (s: string): string | null => (findForbiddenContent(s).length ? null : s);

/** Parses Chrome's computed box-shadow ('rgba(0, 0, 0, 0.1) 0px 1px 2px 0px, …'). */
export function parseShadow(s: string, parse: (c: string) => Rgba | null): ObservedShadow['value'] | null {
  if (!s || s === 'none') return null;
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  const out = [];
  for (const p of parts) {
    const colorM = /(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|#[0-9a-f]{3,8})/i.exec(p);
    const rest = colorM ? p.replace(colorM[0], ' ') : p;
    const nums = [...rest.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]!));
    const c = colorM ? parse(colorM[0]) : ([0, 0, 0, 1] as Rgba);
    if (!c || nums.length < 2) continue;
    out.push({
      offsetX: nums[0]!,
      offsetY: nums[1]!,
      blur: Math.max(0, nums[2] ?? 0),
      spread: nums[3] ?? 0,
      color: { hex: toHex(c), alpha: round(c[3], 2) },
      inset: /\binset\b/.test(p),
    });
  }
  return out.length ? (out as ObservedShadow['value']) : null;
}

export function parseRgbString(s: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(s.trim());
  if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]];
  if (/^#[0-9a-f]{3,8}$/i.test(s.trim())) {
    let h = s.trim().slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  return null;
}

const durMs = (s: string) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);
const EASE_KEYWORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);

export function observe(pages: PageData[], opts: { primaryMode: Mode }): Observation {
  const modes: Mode[] = ['light', 'dark'];
  const records: ColorRecord[] = [];
  const byMode: Record<Mode, ColorRecord[]> = { light: [], dark: [] };
  const assign: Record<Mode, Map<string, string>> = { light: new Map(), dark: new Map() };
  const pageBackground: Partial<Record<Mode, Rgba>> = {};
  let nextColor = 1;

  const newRecord = (mode: Mode, rgba: Rgba): ColorRecord => {
    const rec: ColorRecord = {
      id: `c${nextColor++}`,
      mode,
      rgba,
      keys: new Set(),
      elements: new Set(),
      uses: { background: new Set(), text: new Set(), border: new Set(), fill: new Set(), outline: new Set() },
      sections: new Set(),
      area: 0,
      textArea: 0,
      interactive: new Set(),
      home: new Set(),
      decorative: new Set(),
      samples: [],
      evidence: [],
      mergedFrom: new Set(),
      variables: new Set(),
      widthsSeen: new Map(),
      observed: undefined as unknown as ObservedColor,
    };
    records.push(rec);
    byMode[mode].push(rec);
    return rec;
  };
  // Colours a variable declares exactly are kept apart even when they are close to another
  // (#16171a and #17171c are two tokens, not one colour written twice).
  const declared: Record<Mode, Set<string>> = { light: new Set(), dark: new Set() };
  for (const mode of modes) for (const v of Object.values(pages[0]?.vars[mode] ?? {})) if (v.color) declared[mode].add(colorKey(v.color));
  const find = (mode: Mode, c: Rgba): ColorRecord | null => {
    let best: ColorRecord | null = null;
    let bestD = Infinity;
    const ck = colorKey(c);
    for (const r of byMode[mode]) {
      if (Math.abs(r.rgba[3] - c[3]) > 0.02) continue;
      const rk = colorKey(r.rgba);
      if (rk === ck) return r;
      if (declared[mode].has(ck) && declared[mode].has(rk)) continue;
      const d = deltaE(r.rgba, c);
      if (d < 0.02 && d < bestD) {
        best = r;
        bestD = d;
      }
    }
    return best;
  };

  // ---- colours: first collect exact values with weights, then merge (ΔE_OK < 0.02) ----
  type Raw = { rgba: Rgba; mode: Mode; hits: { page: number; width: number; el: SweepElement; use: keyof ColorRecord['uses']; prop: string }[] };
  const raw = new Map<string, Raw>();
  const widest = new Map<string, number>();
  for (const p of pages) for (const s of p.sweeps) widest.set(`${p.index}|${s.mode}`, Math.max(widest.get(`${p.index}|${s.mode}`) ?? 0, s.width));
  const elements = new Map<string, { page: number; el: SweepElement; mode: Mode; width: number }>();

  for (const p of pages) {
    for (const s of p.sweeps) {
      const isWidest = widest.get(`${p.index}|${s.mode}`) === s.width;
      const { colors, elements: els } = s.result;
      const htmlEl = els.find((e) => e.path === '');
      const bodyEl = els.find((e) => e.tag === 'body');
      if (isWidest && p.index === 0) {
        const bgIdx = bodyEl && bodyEl.bg >= 0 && colors[bodyEl.bg]![3] > 0.9 ? bodyEl.bg : htmlEl && htmlEl.bg >= 0 ? htmlEl.bg : -1;
        pageBackground[s.mode] = bgIdx >= 0 ? colors[bgIdx]! : s.mode === 'dark' ? [18, 18, 18, 1] : [255, 255, 255, 1];
      }
      for (const el of els) {
        if (el.banner) continue;
        if (isWidest && s.mode === opts.primaryMode) elements.set(elementKey(p.index, el.path), { page: p.index, el, mode: s.mode, width: s.width });
        const push = (idx: number, use: keyof ColorRecord['uses'], prop: string) => {
          if (idx < 0) return;
          const c = colors[idx]!;
          const k = `${s.mode}|${colorKey(c)}`;
          let r = raw.get(k);
          if (!r) raw.set(k, (r = { rgba: c, mode: s.mode, hits: [] }));
          r.hits.push({ page: p.index, width: s.width, el, use, prop });
        };
        for (const [field, use, prop] of COLOR_PROPS) {
          if (field === 'fg' && !el.text) continue;
          push(el[field] as number, use, prop);
        }
        const seen = new Set<number>();
        el.border.forEach((b, i) => {
          if (b >= 0 && !seen.has(b)) {
            seen.add(b);
            push(b, 'border', ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'][i]!);
          }
        });
      }
    }
  }
  // Heaviest first, so merges keep the most used notation as the representative.
  const rawSorted = [...raw.values()].sort((a, b) => b.hits.length - a.hits.length);
  for (const r of rawSorted) {
    const rec = find(r.mode, r.rgba) ?? newRecord(r.mode, r.rgba);
    rec.mergedFrom.add(`rgba(${r.rgba.slice(0, 3).map((v) => round(v, 1)).join(', ')}, ${round(r.rgba[3], 3)})`);
    for (const h of r.hits) {
      const ek = elementKey(h.page, h.el.path);
      const sk = sampleKey({ page: h.page, path: h.el.path, prop: h.prop });
      let ws = rec.widthsSeen.get(sk);
      if (!ws) rec.widthsSeen.set(sk, (ws = new Set()));
      ws.add(h.width);
      const isWidest = widest.get(`${h.page}|${r.mode}`) === h.width;
      if (isWidest) assign[r.mode].set(sk, rec.id);
      if (rec.keys.has(sk)) continue;
      rec.keys.add(sk);
      rec.elements.add(ek);
      rec.uses[h.use].add(ek);
      rec.sections.add(`${h.page}|${h.el.sec}`);
      if (h.use === 'background' && isWidest) rec.area += h.el.rect[2] * h.el.rect[3];
      if (h.use === 'text' && isWidest && !h.el.interactive && !h.el.decor) rec.textArea += h.el.rect[2] * h.el.rect[3];
      if (h.el.interactive) rec.interactive.add(ek);
      if (h.el.home && isWidest) rec.home.add(ek);
      if (h.el.decor) rec.decorative.add(ek);
      rec.samples.push({ page: h.page, path: h.el.path, prop: h.prop });
      if (rec.evidence.length < 5 && !rec.evidence.some((e) => e.prop === h.prop && e.selector === h.el.sel)) {
        rec.evidence.push({ page: h.page, width: h.width, mode: r.mode, selector: h.el.sel, axRole: h.el.interactive ?? h.el.role, prop: h.prop, rect: h.el.rect });
      }
    }
  }

  // ---- variables ----
  const varDecls = new Map<string, { selector: string; condition: string | null }[]>();
  for (const p of pages) {
    for (const d of p.scan.declarations) {
      let list = varDecls.get(d.name);
      if (!list) varDecls.set(d.name, (list = []));
      if (list.length < 10 && !list.some((x) => x.selector === d.selector && x.condition === d.condition)) list.push({ selector: d.selector, condition: d.condition });
    }
  }
  const usage = new Map<string, number>();
  for (const p of pages) for (const [k, v] of Object.entries(p.usage)) usage.set(k, Math.max(usage.get(k) ?? 0, v));

  const ensureColor = (mode: Mode, c: Rgba, variable?: string): string => {
    const rec = find(mode, c) ?? newRecord(mode, c);
    if (variable) rec.variables.add(variable);
    return rec.id;
  };
  const colorFor = (mode: Mode, c: Rgba | null): string | null => (c ? (find(mode, c)?.id ?? null) : null);

  const variables: ObservedVariable[] = [];
  for (const [name, declaredIn] of [...varDecls.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!/^--[A-Za-z0-9_-]+$/.test(name)) continue;
    const v: ObservedVariable = {
      name,
      declaredIn: declaredIn.map((d) => ({ selector: sanitize(d.selector) ?? '(omitted)', condition: d.condition ? (sanitize(d.condition.slice(0, 200)) ?? '(omitted)') : null })) as ObservedVariable['declaredIn'],
      values: {},
      usedByElements: usage.get(name) ?? 0,
    };
    const resolves: NonNullable<ObservedVariable['resolvesTo']> = {};
    for (const mode of modes) {
      const val = pages[0]?.vars[mode]?.[name];
      if (!val) continue;
      const s = sanitize(val.raw);
      if (s !== null) v.values[mode] = s;
      if (val.color) resolves[mode] = ensureColor(mode, val.color, name);
    }
    if (Object.keys(resolves).length) v.resolvesTo = resolves;
    variables.push(v);
  }

  // ---- finish colour records ----
  for (const rec of records) {
    const count = rec.elements.size;
    const sections = rec.sections.size;
    let consistent = 0;
    for (const ws of rec.widthsSeen.values()) if (ws.size > 1) consistent++;
    const consistency = rec.widthsSeen.size ? consistent / rec.widthsSeen.size : 0;
    const source = rec.variables.size ? 1 : count >= 2 ? 0.6 : 0.2;
    const [L, C, H] = rgbToOklch(rec.rgba);
    const uses: ObservedColor['uses'] = {};
    for (const [k, set] of Object.entries(rec.uses)) if (set.size) uses[k as keyof ObservedColor['uses']] = set.size;
    const docArea = pages[0]?.sweeps[0] ? pages[0].sweeps[0].result.doc.width * pages[0].sweeps[0].result.doc.height : 0;
    rec.observed = {
      id: rec.id,
      value: { hex: toHex(rec.rgba), oklch: [L, C, H], alpha: round(rec.rgba[3], 3) },
      mode: rec.mode,
      count,
      ...(rec.area && docArea ? { areaShare: round(Math.min(1, rec.area / docArea), 3) } : {}),
      uses,
      ...(rec.variables.size ? { cssVariables: [...rec.variables].sort() } : {}),
      ...(rec.mergedFrom.size > 1 ? { mergedFrom: [...rec.mergedFrom].slice(0, 6) } : {}),
      spread: { sections, componentClusters: 0 },
      evidence: rec.evidence,
      confidence: confidenceOf(count, sections, consistency, source),
    };
  }

  // ---- typography, spacing, radius, shadow, motion, elevation (primary mode) ----
  const styleMap = new Map<string, TypeStyle & { keyset: Set<string> }>();
  const styleOf = new Map<string, string>();
  const familyCount = new Map<string, { count: number; generic: string; list: string }>();
  const spacing = new Map<number, { count: number; props: Record<string, number>; sections: Set<string>; keys: Set<string>; evidence: EvidenceSample[] }>();
  const radius = new Map<string, { value: number; count: number; full: boolean; shapes: Record<string, number>; sections: Set<string>; keys: Set<string>; evidence: EvidenceSample[] }>();
  const shadows = new Map<string, ObservedShadow & { keys: Set<string> }>();
  const motions = new Map<string, ObservedMotion & { keys: Set<string>; on: string[] }>();
  const elev = new Map<string, ObservedElevation & { keys: Set<string> }>();
  const loaded = new Set(pages.flatMap((p) => p.fonts.filter((f) => f.status === 'loaded').map((f) => f.family.toLowerCase())));
  const declaredFonts = new Set(pages.flatMap((p) => p.fonts.map((f) => f.family.toLowerCase())));

  for (const p of pages) {
    const sweeps = p.sweeps.filter((s) => s.mode === opts.primaryMode);
    const maxW = Math.max(...sweeps.map((s) => s.width));
    const byPathOther = new Map<string, Map<number, SweepElement>>();
    for (const s of sweeps) if (s.width !== maxW) for (const el of s.result.elements) {
      let m = byPathOther.get(el.path);
      if (!m) byPathOther.set(el.path, (m = new Map()));
      m.set(s.width, el);
    }
    for (const s of sweeps) {
      const isWidest = s.width === maxW;
      for (const el of s.result.elements) {
        if (el.banner) continue;
        const ek = `${p.index}|${s.width}|${el.path}`;
        const ev = (prop: string): EvidenceSample => ({ page: p.index, width: s.width, mode: s.mode, selector: el.sel, axRole: el.interactive ?? el.role, prop, rect: el.rect });
        if (el.text && isWidest) {
          const fam = firstFamily(el.fontFamily);
          const lh = el.lineHeight === null ? null : round(el.lineHeight, 1);
          const key = `${fam}|${el.fontSize}|${el.fontWeight}|${lh}|${round(el.letterSpacing, 2)}`;
          let st = styleMap.get(key);
          if (!st) {
            st = {
              id: '',
              family: fam,
              size: { value: round(el.fontSize, 2), unit: 'px' },
              weight: el.fontWeight,
              lineHeight: lh === null ? round(1.2, 2) : { value: lh, unit: 'px' },
              letterSpacing: { value: round(el.letterSpacing, 2), unit: 'px' },
              count: 0,
              tags: {},
              evidence: [],
              confidence: 0,
              keyset: new Set(),
            };
            styleMap.set(key, st);
          }
          st.count++;
          st.keyset.add(elementKey(p.index, el.path));
          st.tags![el.tag] = (st.tags![el.tag] ?? 0) + 1;
          if (st.evidence!.length < 5) st.evidence!.push(ev('font'));
          const other = byPathOther.get(el.path);
          if (other) {
            for (const [w, o] of other) {
              if (o.fontSize !== el.fontSize) {
                st.widths ??= { [String(maxW)]: { value: round(el.fontSize, 2), unit: 'px' } };
                st.widths[String(w)] = { value: round(o.fontSize, 2), unit: 'px' };
              }
            }
          }
          const fc = familyCount.get(fam) ?? { count: 0, generic: 'unknown', list: el.fontFamily };
          fc.count++;
          const gen = el.fontFamily.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').toLowerCase()).find((x) => (GENERICS as readonly string[]).includes(x));
          if (gen) fc.generic = gen;
          else if (/mono/i.test(fam)) fc.generic = 'monospace';
          familyCount.set(fam, fc);
        }
        // spacing
        const addSpace = (v: number, prop: 'padding' | 'margin' | 'gap') => {
          if (!(v > 0) || v > 400) return;
          const val = round(v * 2, 0) / 2;
          let sp = spacing.get(val);
          if (!sp) spacing.set(val, (sp = { count: 0, props: {}, sections: new Set(), keys: new Set(), evidence: [] }));
          const k = `${ek}|${prop}`;
          if (sp.keys.has(k)) return;
          sp.keys.add(k);
          sp.count++;
          sp.props[prop] = (sp.props[prop] ?? 0) + 1;
          sp.sections.add(`${p.index}|${el.sec}`);
          if (sp.evidence.length < 5) sp.evidence.push(ev(prop));
        };
        new Set(el.padding).forEach((v) => addSpace(v, 'padding'));
        new Set(el.margin).forEach((v) => addSpace(v, 'margin'));
        new Set(el.gap).forEach((v) => addSpace(v, 'gap'));
        // radius
        const corners = el.radius.filter((r) => r > 0);
        if (corners.length) {
          const v = Math.max(...corners);
          const full = v >= Math.min(el.rect[2], el.rect[3]) / 2 - 0.5;
          const key = full ? 'full' : String(round(v, 1));
          let rd = radius.get(key);
          if (!rd) radius.set(key, (rd = { value: full ? v : round(v, 1), count: 0, full, shapes: {}, sections: new Set(), keys: new Set(), evidence: [] }));
          if (!rd.keys.has(ek)) {
            rd.keys.add(ek);
            rd.count++;
            if (full) rd.value = Math.max(rd.value, v);
            const shape = corners.length === 4 ? 'all' : el.radius[0]! > 0 && el.radius[1]! > 0 ? 'top' : el.radius[2]! > 0 && el.radius[3]! > 0 ? 'bottom' : 'partial';
            rd.shapes[shape] = (rd.shapes[shape] ?? 0) + 1;
            rd.sections.add(`${p.index}|${el.sec}`);
            if (rd.evidence.length < 5) rd.evidence.push(ev('border-radius'));
          }
        }
        if (!isWidest) continue;
        // shadow
        if (el.shadow && el.shadow !== 'none') {
          let sh = shadows.get(el.shadow);
          if (!sh) {
            const value = parseShadow(el.shadow, parseRgbString);
            if (value) shadows.set(el.shadow, (sh = { value, count: 0, evidence: [], confidence: 0, keys: new Set() }));
          }
          if (sh && !sh.keys.has(ek)) {
            sh.keys.add(ek);
            sh.count++;
            if (sh.evidence!.length < 5) sh.evidence!.push(ev('box-shadow'));
          }
        }
        // motion
        const durs = el.transition.duration.split(',').map((x) => x.trim());
        const props = el.transition.property.split(',').map((x) => x.trim());
        const eases = el.transition.easing.split(/,(?![^(]*\))/).map((x) => x.trim());
        durs.forEach((d, i) => {
          const ms = durMs(d);
          if (!(ms > 1)) return;
          const e = eases[i % eases.length] ?? 'ease';
          const cb = /cubic-bezier\(([^)]*)\)/.exec(e);
          const easing: ObservedMotion['easing'] = cb ? (cb[1]!.split(',').map((x) => round(parseFloat(x), 3)) as [number, number, number, number]) : EASE_KEYWORDS.has(e) ? (e as 'ease') : 'ease';
          const key = `${ms}|${JSON.stringify(easing)}`;
          let mo = motions.get(key);
          if (!mo) motions.set(key, (mo = { property: 'transition', duration: { value: round(ms, 0), unit: 'ms' }, easing, count: 0, on: [], evidence: [], confidence: 0, keys: new Set() }));
          if (!mo.keys.has(ek)) {
            mo.keys.add(ek);
            mo.count++;
            const pr = props[i % props.length] ?? 'all';
            if (!mo.on.includes(pr) && mo.on.length < 8 && /^[a-z-]+$/.test(pr)) mo.on.push(pr);
            if (mo.evidence!.length < 5) mo.evidence!.push(ev('transition'));
          }
        });
        // elevation
        if (el.zIndex !== null && el.position !== 'static') {
          const key = `${el.zIndex}|${el.position}`;
          let ex = elev.get(key);
          if (!ex) elev.set(key, (ex = { zIndex: el.zIndex, position: el.position as ObservedElevation['position'], count: 0, evidence: [], confidence: 0, keys: new Set() }));
          if (!ex.keys.has(ek)) {
            ex.keys.add(ek);
            ex.count++;
            if ((el.position === 'sticky' || el.position === 'fixed') && el.rect[1] < 10) ex.kind = 'sticky-header';
            if (ex.evidence!.length < 5) ex.evidence!.push(ev('z-index'));
          }
        }
      }
    }
  }

  const styles = [...styleMap.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  styles.forEach((s, i) => {
    s.id = `t${i + 1}`;
    s.confidence = confidenceOf(s.count, 1, s.widths ? 0.5 : 1, s.count > 1 ? 0.6 : 0.2);
    if (pages.some((p) => p.scan.hasClamp) && s.widths) s.fluid = { detected: true };
    for (const k of s.keyset) styleOf.set(k, s.id);
  });

  const families: FontFamily[] = [...familyCount.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, fc]) => ({
      name,
      generic: fc.generic as FontFamily['generic'],
      count: fc.count,
      loadedVia: loaded.has(name.toLowerCase()) ? 'webfont' : declaredFonts.has(name.toLowerCase()) ? 'webfont' : SYSTEM_FONTS.test(name) ? 'system' : 'unknown',
      license: licenseOf(name),
      fileStored: false,
      oflAlternatives: oflAlternatives(name, fc.generic),
    }));

  const lengthVars = (re: RegExp) => {
    const out = new Map<number, string[]>();
    for (const v of variables) {
      if (!re.test(v.name)) continue;
      const val = pages[0]?.vars[opts.primaryMode]?.[v.name];
      if (val?.px != null && val.px > 0) out.set(round(val.px, 1), [...(out.get(round(val.px, 1)) ?? []), v.name]);
    }
    return out;
  };
  const spaceVars = lengthVars(/space|spacing|gap|gutter|^--s-?\d|^--sp-?\d/i);
  const radiusVars = lengthVars(/radius|rounded|^--r-?\d|corner/i);

  const spacingOut = [...spacing.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, sp]) => ({
      value: { value, unit: 'px' as const },
      count: sp.count,
      props: sp.props,
      ...(spaceVars.get(value) ? { cssVariables: spaceVars.get(value)!.slice(0, 5) } : {}),
      evidence: sp.evidence,
      confidence: confidenceOf(sp.count, sp.sections.size, 0.5, spaceVars.has(value) ? 1 : sp.count > 1 ? 0.6 : 0.2),
      sections: sp.sections.size,
    }));
  const radiusOut = [...radius.values()]
    .sort((a, b) => a.value - b.value)
    .map((rd) => ({
      value: { value: rd.value, unit: 'px' as const },
      count: rd.count,
      shapes: rd.shapes,
      ...(rd.full ? { kind: 'full' as const } : {}),
      ...(radiusVars.get(rd.value) ? { cssVariables: radiusVars.get(rd.value)!.slice(0, 5) } : {}),
      evidence: rd.evidence,
      confidence: confidenceOf(rd.count, rd.sections.size, 0.5, radiusVars.has(rd.value) ? 1 : rd.count > 1 ? 0.6 : 0.2),
      sections: rd.sections.size,
    }));

  const strip = <T extends { keys: Set<string>; count: number; confidence: number }>(m: Map<string, T>, limit = 30) =>
    [...m.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map((item) => {
        const rest: Omit<T, 'keys'> & { keys?: unknown } = { ...item };
        delete rest.keys;
        return { ...rest, confidence: confidenceOf(item.count, 1, 0.5, item.count > 1 ? 0.6 : 0.2) };
      });

  const breakpoints = new Map<number, ObservedBreakpoint>();
  for (const p of pages) for (const b of p.scan.breakpoints) {
    const q = sanitize(b.query);
    if (!q) continue;
    const prev = breakpoints.get(b.px);
    if (prev) prev.rulesCount += b.rules;
    else breakpoints.set(b.px, { value: { value: b.px, unit: 'px' }, query: `(${/min-width/.test(b.query) ? 'min' : 'max'}-width: ${b.px}px)`, rulesCount: b.rules, confidence: 0 });
  }
  const bpOut = [...breakpoints.values()].sort((a, b) => a.value.value - b.value.value).map((b) => ({ ...b, confidence: round(Math.min(1, 0.4 + 0.1 * b.rulesCount), 2) }));

  return {
    colors: records,
    assign,
    colorFor,
    ensureColor,
    families,
    styles,
    styleOf,
    spacing: spacingOut,
    radius: radiusOut,
    shadow: strip(shadows) as ObservedShadow[],
    motion: strip(motions) as ObservedMotion[],
    elevation: strip(elev) as ObservedElevation[],
    breakpoints: bpOut,
    variables,
    elements,
    primaryMode: opts.primaryMode,
    pageBackground,
  };
}

/** ObservedColor objects for colours created after observe() (from variables or states). */
export function finishLateColors(o: Observation) {
  for (const rec of o.colors) {
    if (rec.observed) continue;
    const [L, C, H] = rgbToOklch(rec.rgba);
    rec.observed = {
      id: rec.id,
      value: { hex: toHex(rec.rgba), oklch: [L, C, H], alpha: round(rec.rgba[3], 3) },
      mode: rec.mode,
      count: 0,
      uses: {},
      ...(rec.variables.size ? { cssVariables: [...rec.variables].sort() } : {}),
      spread: { sections: 0, componentClusters: 0 },
      evidence: [],
      confidence: rec.variables.size ? 0.3 : 0.1,
    };
  }
}
