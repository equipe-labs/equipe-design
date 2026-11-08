import type { Catalog as OutCatalog, CatalogComponent, CatalogProp as OutProp, CatalogState, CatalogVariant, CoverageRow, Mode, Role, Scale, TypeRole } from '@equipe-design/schema';
import type { Rgba, StateProps } from '../capture/inpage.ts';
import { chroma, colorKey, deltaE, hueFamily, round } from '../analyze/color.ts';
import { diffState } from '../analyze/components.ts';
import type { Limits } from '../analyze/limits.ts';
import { elementKey } from '../analyze/model.ts';
import { parseRgbString, parseShadow, type Observation } from '../analyze/observe.ts';
import { mostCommon, type PageCatalog, type RawExample, type RawGroup, type RawProps } from './analyze.ts';
import type { DetectedBy } from './match.ts';
import type { Catalog, CatalogEntry } from './types.ts';

// Turns the per-page catalog reads into the schema's `inferred.catalog`: merges pages, ties
// every value to a token role (colour role, radius/space step, type role), fills the state
// table from forced states and on-page examples, and lists what was not found.

export interface BuildInput {
  catalog: Catalog;
  pages: { index: number; width: number; pc: PageCatalog }[];
  obs: Observation;
  mode: Mode;
  roles: Role[];
  scales: { spacing?: Scale; radius?: Scale };
  typeRoles: TypeRole[];
  limits: Limits;
  statesEnabled: boolean;
}

// Which colour roles a property prefers when two roles share one colour.
const ROLE_PRIORITY: Record<string, string[]> = {
  background: ['primary', 'destructive', 'secondary', 'accent', 'success', 'warning', 'raised', 'surface', 'background'],
  color: ['on-primary', 'primary', 'destructive', 'text', 'muted-text', 'success', 'warning', 'accent'],
  border: ['border', 'border-strong', 'ring', 'primary', 'destructive'],
};
const NEAR_DELTA_E = 0.04;
const BY_LABEL: Record<DetectedBy, string> = {
  role: '접근성 역할',
  tag: '태그',
  slot: 'data-slot 표시',
  attrs: '속성',
  hint: '클래스 이름 단서(약함)',
  structure: '모양·구조',
};
/** Roles of things a person can focus or press; :focus-visible and :active are not read on anything else. */
const OPERABLE = new Set(['button', 'link', 'tab', 'checkbox', 'switch', 'menuitem', 'textbox', 'searchbox', 'combobox', 'option', 'radio', 'slider']);
const BY_CONFIDENCE: Record<DetectedBy, number> = { slot: 0.92, role: 0.85, tag: 0.85, attrs: 0.8, structure: 0.5, hint: 0.4 };

export function buildCatalog(input: BuildInput): OutCatalog {
  const { catalog, pages, obs, mode, roles, scales, typeRoles, limits } = input;
  const rgbaOf = new Map(obs.colors.map((c) => [c.id, c.rgba]));
  const cid = (c: Rgba | null): string | null => (c ? (obs.colorFor(mode, c) ?? obs.ensureColor(mode, c)) : null);
  const ref = (c: Rgba | null) => (c ? cid(c)! : 'none');
  const pageBg = obs.pageBackground[mode] ?? null;
  const roleColor = new Map<string, string>(); // role -> colour id (primary mode)
  for (const r of roles) {
    const id = mode === 'light' ? r.light : r.dark;
    if (id) roleColor.set(r.role, id);
  }

  const colorRole = (c: Rgba, prop: string): { role: string | null; match: 'exact' | 'nearest' | 'none'; distance?: number } => {
    const id = cid(c)!;
    const order = ROLE_PRIORITY[prop] ?? [];
    const exact = [...roleColor.entries()].filter(([, v]) => v === id).map(([k]) => k);
    if (exact.length) return { role: [...order, ...exact].find((r) => exact.includes(r))!, match: 'exact', distance: 0 };
    let best: { role: string; d: number } | null = null;
    for (const [role, rid] of roleColor) {
      const rc = rgbaOf.get(rid);
      if (!rc) continue;
      const d = deltaE(c, rc) + (order.includes(role) ? 0 : 0.01);
      if (!best || d < best.d) best = { role, d };
    }
    if (best && best.d <= NEAR_DELTA_E) return { role: best.role, match: 'nearest', distance: round(best.d, 3) };
    return { role: null, match: 'none' };
  };
  const stepRole = (v: number, scale: Scale | undefined, prefix: string): { role: string | null; match: 'exact' | 'nearest' | 'none'; distance?: number } => {
    if (!scale?.steps.length) return { role: null, match: 'none' };
    let bi = -1;
    let bd = Infinity;
    scale.steps.forEach((s, i) => {
      if (Math.abs(s - v) < bd) {
        bd = Math.abs(s - v);
        bi = i;
      }
    });
    if (bd <= 0.5) return { role: `${prefix}.${bi + 1}`, match: 'exact', distance: 0 };
    if (bd <= 2) return { role: `${prefix}.${bi + 1}`, match: 'nearest', distance: round(bd, 1) };
    return { role: null, match: 'none' };
  };

  const propsOf = (entry: CatalogEntry, p: RawProps, page: number): OutProp[] => {
    const out: OutProp[] = [];
    const len = (value: number) => ({ value, unit: 'px' as const });
    for (const prop of entry.props) {
      switch (prop) {
        case 'background':
          if (p.bg) out.push({ prop, color: cid(p.bg)!, ...colorRole(p.bg, 'background') });
          break;
        case 'color':
          if (p.fg) out.push({ prop, color: cid(p.fg)!, ...colorRole(p.fg, 'color') });
          break;
        case 'border':
          if (p.border) out.push({ prop, color: cid(p.border)!, ...colorRole(p.border, 'border') });
          break;
        case 'borderWidth':
          if (p.borderWidth > 0) out.push({ prop, length: len(round(p.borderWidth, 1)), role: null, match: 'none' });
          break;
        case 'radius':
          if (p.radius !== null) out.push({ prop, length: len(p.radius), ...(p.radius === 9999 ? { role: 'radius.full', match: 'exact' as const, distance: 0 } : stepRole(p.radius, scales.radius, 'radius')) });
          break;
        case 'paddingX':
        case 'paddingY':
        case 'gap': {
          const v = prop === 'paddingX' ? p.paddingX : prop === 'paddingY' ? p.paddingY : p.gap;
          if (v > 0) out.push({ prop, length: len(round(v, 1)), ...stepRole(v, scales.spacing, 'space') });
          break;
        }
        case 'height':
        case 'width':
          out.push({ prop, length: len(prop === 'height' ? p.height : p.width), role: null, match: 'none' });
          break;
        case 'shadow': {
          const layers = parseShadow(p.shadow, parseRgbString);
          if (layers) out.push({ prop, shadow: layers, role: null, match: 'none' });
          break;
        }
        case 'typeStyle': {
          const id = p.textPath === null ? undefined : obs.styleOf.get(elementKey(page, p.textPath));
          if (id) {
            const tr = typeRoles.find((t) => t.style === id)?.role;
            out.push({ prop, typeStyle: id, role: tr ? `type.${tr}` : null, match: tr ? 'exact' : 'none' });
          }
          break;
        }
        case 'opacity':
          if (p.opacity < 1) out.push({ prop, number: round(p.opacity, 2), role: null, match: 'none' });
          break;
      }
    }
    return out;
  };

  const diffProps = (a: RawProps, b: RawProps): Record<string, string> => {
    const d: Record<string, string> = {};
    const same = (x: Rgba | null, y: Rgba | null) => (x && y ? colorKey(x) === colorKey(y) : x === y);
    if (!same(a.bg, b.bg)) d['background-color'] = `${ref(a.bg)} -> ${ref(b.bg)}`;
    if (!same(a.fg, b.fg)) d['color'] = `${ref(a.fg)} -> ${ref(b.fg)}`;
    if (!same(a.border, b.border)) d['border-color'] = `${ref(a.border)} -> ${ref(b.border)}`;
    if (a.borderWidth !== b.borderWidth) d['border-width'] = `${a.borderWidth}px -> ${b.borderWidth}px`;
    if (a.radius !== b.radius) d['border-radius'] = `${a.radius ?? 0}px -> ${b.radius ?? 0}px`;
    if (a.opacity !== b.opacity) d['opacity'] = `${round(a.opacity, 2)} -> ${round(b.opacity, 2)}`;
    if (a.shadow !== b.shadow) d['box-shadow'] = `${a.shadow === 'none' ? 'none' : 'shadow'} -> ${b.shadow === 'none' ? 'none' : 'shadow'}`;
    if (Math.abs(a.height - b.height) >= 1) d['height'] = `${a.height}px -> ${b.height}px`;
    return d;
  };

  // ---- merge the pages ------------------------------------------------------------
  interface PGroup {
    page: number;
    width: number;
    g: RawGroup;
    forced: PageCatalog['forced'];
  }
  const merged = new Map<string, { by: Set<DetectedBy>; instances: number; pages: Set<number>; parts: Map<string, number>; groups: Map<string, PGroup[]> }>();
  for (const { index, width, pc } of pages) {
    for (const e of pc.entries) {
      let m = merged.get(e.name);
      if (!m) merged.set(e.name, (m = { by: new Set(), instances: 0, pages: new Set(), parts: new Map(), groups: new Map() }));
      e.by.forEach((b) => m!.by.add(b));
      m.instances += e.instances;
      m.pages.add(index);
      for (const [k, n] of Object.entries(e.parts)) m.parts.set(k, (m.parts.get(k) ?? 0) + n);
      for (const g of e.groups) (m.groups.get(g.key) ?? m.groups.set(g.key, []).get(g.key)!).push({ page: index, width, g, forced: pc.forced });
    }
  }

  const components: CatalogComponent[] = [];
  const coverage: CoverageRow[] = [];
  let k = 0;
  for (const entry of catalog.components) {
    const m = merged.get(entry.name);
    if (!m) {
      coverage.push({ name: entry.name, found: false, instances: 0, variants: 0, component: null, detectable: entry.detectable, note: entry.hintWhenMissing });
      continue;
    }
    k++;
    const compId = `m${k}`;
    const ranked = [...m.groups.entries()]
      .map(([key, list]) => ({ key, list, count: list.reduce((a, x) => a + x.g.count, 0) }))
      .sort((a, b) => b.count - a.count);
    const names = new Map<string, number>();
    const missing = new Set<string>();
    const evidenceOf = (list: PGroup[]) => list.flatMap((x) => x.g.evidence.map((ev) => ({ page: x.page, width: x.width, mode, selector: ev.sel, axRole: ev.role, prop: '*', rect: ev.rect }))).slice(0, 5);
    const variants: CatalogVariant[] = ranked.map((r, i) => {
      const best = [...r.list].sort((a, b) => b.g.count - a.g.count)[0]!;
      const p = best.g.props;
      const dataVariant = r.list.find((x) => x.g.dataVariant)?.g.dataVariant;
      let name = variantName(entry, p, pageBg, names);
      const n = (names.get(name) ?? 0) + 1;
      names.set(name, n);
      if (n > 1) name = `${name}-${n}`;
      const states: CatalogState[] = [];
      for (const s of entry.states) {
        if (s === 'default') {
          states.push({ name: s, observed: true });
          continue;
        }
        if (s === 'hover' || s === 'focus-visible' || s === 'active') {
          if (s !== 'hover' && !r.list.some((x) => x.g.evidence.some((ev) => ev.role && OPERABLE.has(ev.role)))) {
            states.push({ name: s, observed: false, limit: limits.add('state-no-diff', `inferred.catalog.components.${compId}.*.states`, `:${s}는 누르거나 초점을 받는 요소(버튼·링크·입력 등)에서만 읽음. 이 컴포넌트의 루트는 그런 요소가 아님`, '루트의 그 상태 칸이 빔(안의 버튼 등은 button 등에서 봄)', null) });
            continue;
          }
          let diff: Record<string, string> | null = null;
          let tried = false;
          for (const x of r.list) {
            for (const path of x.g.reps) {
              const rec = x.forced[path];
              if (!rec?.default || !rec[s]) continue;
              tried = true;
              const d = diffState(rec.default as StateProps, rec[s] as StateProps, ref);
              if (Object.keys(d).length) {
                diff = d;
                break;
              }
            }
            if (diff) break;
          }
          if (diff) states.push({ name: s, observed: true, method: 'forcePseudoState', diff });
          else if (tried) states.push({ name: s, observed: false, limit: limits.add('state-no-diff', `inferred.catalog.components.${compId}.*.states`, `:${s} 강제로 계산 스타일 차이가 없음(일부 변형). JS로 그리는 상태이거나 상태 스타일이 없을 수 있음`, '해당 변형의 그 상태 칸이 빔', null) });
          else {
            missing.add(s);
            states.push({ name: s, observed: false, limit: limits.add(input.statesEnabled ? 'state-no-diff' : 'interaction-not-collected', `inferred.catalog.components.${compId}.*.states`, input.statesEnabled ? `:${s} 강제 대상이 한도(화면당 요소 수)를 넘었거나 다시 찾지 못함` : '--no-states로 상태 강제를 끔', '해당 변형의 그 상태 칸이 빔', input.statesEnabled ? null : '--no-states 없이 다시 실행') });
          }
          continue;
        }
        const ex = r.list.map((x) => ({ page: x.page, width: x.width, e: x.g.states[s] })).filter((x): x is { page: number; width: number; e: RawExample } => !!x.e);
        if (ex.length) {
          const diff = diffProps(p, ex[0]!.e.props);
          states.push({
            name: s,
            observed: true,
            method: 'on-page-example',
            ...(Object.keys(diff).length ? { diff } : {}),
            count: ex.reduce((a, x) => a + x.e.count, 0),
            evidence: ex.flatMap((x) => x.e.evidence.map((ev) => ({ page: x.page, width: x.width, mode, selector: ev.sel, axRole: ev.role, prop: '*', rect: ev.rect }))).slice(0, 3),
          });
        } else {
          missing.add(s);
          states.push({ name: s, observed: false, limit: limits.add('state-not-on-page', `inferred.catalog.components.${compId}.*.states`, '페이지에 이 상태의 예시(checked·open·disabled 등)가 없음. 속성 주입은 하지 않음', '해당 상태 칸이 빔', '그 상태가 나오는 화면의 URL을 주기') });
        }
      }
      return {
        id: `${compId}v${i + 1}`,
        suggestedName: name,
        nameIsSuggestion: true as const,
        count: r.count,
        ...(dataVariant ? { dataVariant } : {}),
        props: propsOf(entry, p, best.page),
        structure: {
          icon: { present: best.g.structure.icon !== null, position: best.g.structure.icon },
          label: { present: best.g.structure.label !== null, position: best.g.structure.label },
          ...(best.g.structure.parts.length ? { parts: best.g.structure.parts } : {}),
        },
        states,
        evidence: evidenceOf(r.list),
        confidence: round(Math.min(0.95, confidenceOf(m.by, r.count)), 2),
      };
    });
    const sizes = entry.props.includes('height') ? sizeAxis(ranked.flatMap((r) => r.list.flatMap((x) => x.g.heights))) : [];
    const reasons = [`${[...m.by].map((b) => BY_LABEL[b]).join('·')}로 ${m.instances}개를 찾음 (${m.pages.size}개 화면)`];
    if (missing.size) reasons.push(`상태 ${[...missing].join('·')}는 일부 변형에서 읽지 못함 — limits 참고`);
    reasons.push('이름은 규칙으로 붙인 제안이고 값은 주 모드(첫 모드) 기준');
    components.push({
      id: compId,
      name: entry.name,
      category: entry.category,
      detectedBy: [...m.by] as CatalogComponent["detectedBy"],
      instances: m.instances,
      pages: [...m.pages].sort((a, b) => a - b),
      variants,
      sizes: sizes.map((s) => ({ label: s.label, height: { value: s.height, unit: 'px' as const }, count: s.count })),
      parts: (entry.parts ?? []).filter((p, i, all) => all.findIndex((q) => q.name === p.name) === i).map((p) => ({ name: p.name, present: m.parts.has(p.name), count: m.parts.get(p.name) ?? 0 })),
      reasons,
      confidence: round(Math.max(...variants.map((v) => v.confidence)), 2),
    });
    coverage.push({ name: entry.name, found: true, instances: m.instances, variants: variants.length, component: compId, detectable: entry.detectable, note: null });
  }
  const notFound = coverage.filter((c) => !c.found).length;
  if (notFound) limits.add('component-not-found', 'inferred.catalog.coverage', `기준표 ${coverage.length}종 중 ${notFound}종은 읽은 화면에서 찾지 못함`, '못 찾은 컴포넌트의 변형·상태가 없음. 서비스에 없는 것인지 이 화면에 안 보이는 것인지는 구분하지 않음', '다른 화면(크롤)이나 열린 상태(메뉴·대화상자)를 보여 주는 URL을 주기');
  return {
    reference: { name: catalog.reference.name, source: catalog.reference.source, snapshot: catalog.reference.snapshot, count: catalog.components.length },
    components,
    coverage,
  };
}

function confidenceOf(by: Set<DetectedBy>, count: number): number {
  const base = Math.max(...[...by].map((b) => BY_CONFIDENCE[b]));
  return base * (0.7 + 0.3 * Math.min(1, Math.log2(count + 1) / 3));
}

const ACTION = new Set(['button', 'toggle', 'badge', 'tabs', 'toggle-group', 'button-group', 'pagination', 'item']);

function variantName(entry: CatalogEntry, p: RawProps, pageBg: Rgba | null, taken: Map<string, number>): string {
  // A fill the colour of the page is not a fill: an outlined or plain control.
  const filled = p.bg && !(pageBg && deltaE(p.bg, pageBg) < 0.02);
  if (ACTION.has(entry.name) || entry.category === 'action') {
    if (filled && p.bg) {
      if (hueFamily(p.bg) === 'red' && chroma(p.bg) > 0.1) return 'destructive';
      return taken.has('primary') ? 'secondary' : 'primary';
    }
    return p.border ? 'outline' : 'ghost';
  }
  return filled ? 'filled' : p.border ? 'outlined' : 'plain';
}

/** Heights of one component's instances merged within ±2px, shortest to tallest, labelled by rank. */
function sizeAxis(heights: number[]): { label: string; height: number; count: number }[] {
  if (!heights.length || (mostCommon(heights) ?? 0) > 96) return [];
  const sorted = [...heights].sort((a, b) => a - b);
  const clusters: { h: number[] }[] = [];
  for (const h of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && h - last.h[last.h.length - 1]! <= 2) last.h.push(h);
    else clusters.push({ h: [h] });
  }
  const top = clusters.sort((a, b) => b.h.length - a.h.length).slice(0, 5).sort((a, b) => a.h[0]! - b.h[0]!);
  const labels = top.length === 1 ? ['default'] : top.length === 2 ? ['sm', 'lg'] : top.length === 3 ? ['sm', 'md', 'lg'] : top.length === 4 ? ['xs', 'sm', 'md', 'lg'] : ['xs', 'sm', 'md', 'lg', 'xl'];
  return top.map((c, i) => ({ label: labels[i]!, height: mostCommon(c.h)!, count: c.h.length }));
}
