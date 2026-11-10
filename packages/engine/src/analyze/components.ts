import type { Component, EvidenceSample, Mode, State, Variant } from '@equipe-design/schema';
import type { Rgba, StateProps, SweepElement, SweepResult } from '../capture/inpage.ts';
import { colorKey, round } from './color.ts';
import type { Limits } from './limits.ts';
import { elementKey } from './model.ts';
import type { Observation } from './observe.ts';

// Component candidates (README 2.8): accessibility role first, then a visual fingerprint
// quantised to tokens, then "looks like a button" links, then repeated card structures.

export type Kind = Component['kind'];
const ROLE_KIND: Record<string, Kind> = {
  button: 'button',
  link: 'link',
  textbox: 'textbox',
  searchbox: 'textbox',
  checkbox: 'checkbox',
  switch: 'switch',
  tab: 'tab',
  combobox: 'combobox',
  dialog: 'dialog',
  menuitem: 'menuitem',
};

export interface Candidate {
  kind: Kind;
  detectedBy: Component['detectedBy'][number][];
  key: string;
  bg: Rgba | null;
  fg: Rgba | null;
  border: Rgba | null;
  radius: number | null;
  height: number | null;
  paddingX: number | null;
  /** Heights of every instance; the size axis (README 2.8.5) rather than separate variants. */
  heights: number[];
  paddings: number[];
  textPath: string | null;
  paths: string[];
  elements: SweepElement[];
}

const opaque = (c: Rgba | null) => (c && c[3] >= 0.05 ? c : null);

function textDescendant(el: SweepElement, byPrefix: SweepElement[]): string | null {
  if (el.text) return el.path;
  const pre = el.path + '/';
  for (const e of byPrefix) if (e.path.startsWith(pre) && e.text) return e.path;
  return null;
}

/** Groups interactive elements and cards of one sweep by their visual fingerprint. */
export function findCandidates(sweep: SweepResult): Candidate[] {
  const { elements, colors } = sweep;
  const col = (i: number) => (i >= 0 ? colors[i]! : null);
  const groups = new Map<string, Candidate>();
  const add = (el: SweepElement, kind: Kind, by: Candidate['detectedBy']) => {
    const bg = opaque(col(el.bg));
    const fgEl = el.text ? el : elements.find((e) => e.path.startsWith(el.path + '/') && e.text) ?? el;
    const fg = col(fgEl.fg);
    const bc = el.borderWidth.some((w) => w > 0) ? col(el.border.find((b) => b >= 0) ?? -1) : null;
    const r = Math.max(...el.radius);
    const full = r >= Math.min(el.rect[2], el.rect[3]) / 2 - 0.5;
    const radius = r > 0 ? (full ? 9999 : round(r, 1)) : null;
    const height = kind === 'card' ? null : Math.round(el.rect[3] / 2) * 2;
    const paddingX = round(el.padding[3]!, 0);
    const key = [kind, bg && colorKey(bg), fg && colorKey(fg), bc && colorKey(bc), radius === 9999 ? 'full' : radius].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { kind, detectedBy: [...by], key, bg, fg, border: bc, radius, height, paddingX, heights: [], paddings: [], textPath: null, paths: [], elements: [] };
      groups.set(key, g);
    }
    for (const b of by) if (!g.detectedBy.includes(b)) g.detectedBy.push(b);
    g.paths.push(el.path);
    g.elements.push(el);
    if (height !== null) g.heights.push(height);
    g.paddings.push(paddingX);
    g.textPath ??= textDescendant(el, elements);
  };
  const claimed = new Set<string>();
  for (const el of elements) {
    if (el.banner || el.decor) continue;
    let kind = el.role ? ROLE_KIND[el.role] : undefined;
    if (!kind) continue;
    // Skip the inner element of a nested interactive (span inside a button…).
    const by: Candidate['detectedBy'] = ['ax-role', 'style-cluster'];
    const filled = opaque(col(el.bg)) !== null || el.borderWidth.some((w) => w > 0);
    if (kind === 'link' && filled && el.padding[3]! >= 8 && el.rect[3] >= 28 && el.rect[3] <= 64) {
      kind = 'button';
      by.push('visual-shape');
    }
    if (kind === 'link' && !el.text && !elements.some((e) => e.path.startsWith(el.path + '/') && e.text)) continue; // icon/image links
    claimed.add(el.path);
    add(el, kind, by);
  }
  // Cards: repeated structure with a surface (background or border), a radius and padding.
  const shapes = new Map<string, SweepElement[]>();
  for (const el of elements) {
    if (el.banner || el.decor || el.interactive || claimed.has(el.path) || !el.shape) continue;
    const surface = opaque(col(el.bg)) !== null || el.borderWidth.some((w) => w > 0);
    if (!surface || Math.max(...el.radius) <= 0 || Math.min(el.padding[0]!, el.padding[3]!) < 12) continue;
    if (el.rect[2] * el.rect[3] < 10_000 || el.tag === 'body' || el.tag === 'html') continue;
    const k = el.shape + '|' + el.sel;
    shapes.set(k, [...(shapes.get(k) ?? []), el]);
  }
  for (const list of shapes.values()) if (list.length >= 3) for (const el of list) add(el, 'card', ['repeated-structure']);
  for (const g of groups.values()) {
    g.height = mostCommon(g.heights);
    g.paddingX = mostCommon(g.paddings);
  }
  return [...groups.values()].sort((a, b) => b.paths.length - a.paths.length);
}

/** Up to three representatives per candidate group, for the state pass. */
export function statePaths(cands: Candidate[], perGroup = 3, maxGroups = 24): string[] {
  const out: string[] = [];
  for (const c of cands.slice(0, maxGroups)) out.push(...c.paths.slice(0, perGroup));
  return out;
}

const STATE_PROPS: [keyof StateProps, string][] = [
  ['bg', 'background-color'],
  ['fg', 'color'],
  ['border', 'border-color'],
  ['outline', 'outline'],
  ['shadow', 'box-shadow'],
  ['opacity', 'opacity'],
  ['textDecoration', 'text-decoration-line'],
  ['transform', 'transform'],
];

export function buildComponents(input: {
  page: number;
  width: number;
  mode: Mode;
  candidates: Candidate[];
  states: Record<string, Partial<Record<string, StateProps>>> | null;
  obs: Observation;
  limits: Limits;
  statesEnabled: boolean;
}): { components: Component[]; ringColors: Map<string, number>; variantOfElement: Map<string, string> } {
  const { obs, limits, mode, candidates, states } = input;
  const ringColors = new Map<string, number>();
  const variantOfElement = new Map<string, string>();
  const cid = (c: Rgba | null) => (c ? (obs.colorFor(mode, c) ?? obs.ensureColor(mode, c)) : null);
  const ref = (c: Rgba | null) => (c ? cid(c)! : 'none');
  const byKind = new Map<Kind, Candidate[]>();
  for (const c of candidates) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const components: Component[] = [];
  const ORDER: Kind[] = ['button', 'link', 'textbox', 'checkbox', 'switch', 'tab', 'combobox', 'menuitem', 'dialog', 'card', 'badge', 'list-row'];
  let k = 0;
  for (const kind of ORDER) {
    const list = byKind.get(kind);
    if (!list?.length) continue;
    k++;
    const compId = `k${k}`;
    const variants: Variant[] = [];
    const nameCount = new Map<string, number>();
    const disabledEls = list.flatMap((c) => c.elements.filter((e) => e.disabled));
    const kept = list.filter((c) => c.elements.some((e) => !e.disabled)).slice(0, 8);
    kept.forEach((c, i) => {
      const vid = `${compId}v${i + 1}`;
      let base = kind === 'button' || kind === 'tab' ? (c.bg ? 'primary' : c.border ? 'secondary' : 'ghost') : kind === 'link' ? 'link' : kind === 'card' ? (c.border && !c.bg ? 'outlined' : 'filled') : 'default';
      const n = (nameCount.get(base) ?? 0) + 1;
      nameCount.set(base, n);
      if (n > 1) base = `${base}-${n}`;
      for (const p of c.paths) variantOfElement.set(elementKey(input.page, p), vid);
      const st: Variant['states'] = {
        default: { observed: true },
        hover: { observed: false },
        'focus-visible': { observed: false },
        active: { observed: false },
        disabled: { observed: false },
      };
      for (const name of ['hover', 'focus-visible', 'active'] as const) {
        if (!input.statesEnabled) {
          st[name] = { observed: false, limit: limits.add('interaction-not-collected', 'inferred.components.*.*.' + 'states', '--no-states로 상태 강제를 끔', 'hover·focus-visible·active 칸이 빔', '--no-states 없이 다시 실행') };
          continue;
        }
        let diff: Record<string, string> | null = null;
        let tried = false;
        for (const p of c.paths.slice(0, 3)) {
          const rec = states?.[p];
          if (!rec?.default || !rec[name]) continue;
          tried = true;
          const d = diffState(rec.default, rec[name]!, ref);
          if (name === 'focus-visible' && rec[name]!.outline) {
            const id = cid(rec[name]!.outline);
            if (id) ringColors.set(id, (ringColors.get(id) ?? 0) + 1);
          }
          if (Object.keys(d).length) {
            diff = d;
            break;
          }
        }
        if (diff) st[name] = { observed: true, method: 'forcePseudoState', diff };
        else if (tried)
          st[name] = {
            observed: false,
            limit: limits.add('state-no-diff', `inferred.components.*.*.${name}`, `:${name} 강제로 계산 스타일 차이가 없음(일부 변형). JS로 그리는 상태이거나 상태 스타일이 없을 수 있음. 스크린샷 비교는 아직 하지 않음`, `해당 변형의 ${name} 칸이 빔`, null),
          };
        else st[name] = { observed: false, limit: limits.add('state-no-diff', `inferred.components.*.*.${name}`, `:${name} 강제 대상 요소를 다시 찾지 못함`, `해당 변형의 ${name} 칸이 빔`, null) };
      }
      const dis = disabledEls.find((e) => e.role === c.elements[0]!.role);
      if (dis) {
        const d: Record<string, string> = {};
        if (dis.opacity !== c.elements[0]!.opacity) d.opacity = `${c.elements[0]!.opacity} -> ${dis.opacity}`;
        st.disabled = { observed: true, method: 'on-page-example', ...(Object.keys(d).length ? { diff: d } : {}) };
      } else {
        st.disabled = {
          observed: false,
          limit: limits.add('state-not-on-page', 'inferred.components.*.*.disabled', '페이지에 disabled·aria-disabled 예시가 없음. 속성 주입은 기본으로 하지 않음', '상태 표의 disabled 칸이 빔', '그 상태가 나오는 화면의 URL을 주기'),
        };
      }
      const evidence: EvidenceSample[] = c.elements.slice(0, 3).map((e) => ({ page: input.page, width: input.width, mode, selector: e.sel, axRole: e.role, prop: '*', rect: e.rect }));
      variants.push({
        id: vid,
        suggestedName: base,
        nameIsSuggestion: true,
        count: c.paths.length,
        fingerprint: {
          background: cid(c.bg),
          color: cid(c.fg),
          border: cid(c.border),
          radius: c.radius === null ? null : { value: c.radius, unit: 'px' },
          height: c.height === null ? null : { value: c.height, unit: 'px' },
          paddingX: c.paddingX === null ? null : { value: c.paddingX, unit: 'px' },
          typeStyle: c.textPath ? (obs.styleOf.get(elementKey(input.page, c.textPath)) ?? null) : null,
        },
        states: st,
        evidence,
      });
    });
    const instances = list.reduce((a, c) => a + c.paths.length, 0);
    const heights = new Map<number, number>();
    if (kind !== 'card') for (const c of list) for (const h of c.heights) heights.set(h, (heights.get(h) ?? 0) + 1);
    const detectedBy = [...new Set(list.flatMap((c) => c.detectedBy))] as Component['detectedBy'];
    const reasons: string[] = [];
    if (detectedBy.includes('ax-role')) reasons.push(`접근성 역할(${kind === 'button' ? 'button' : kind})로 ${instances}개를 찾음`);
    if (detectedBy.includes('visual-shape')) reasons.push('배경·테두리와 패딩(≥8px), 높이 28~64px인 링크는 버튼으로 묶음');
    if (detectedBy.includes('repeated-structure')) reasons.push('같은 태그 구조가 3번 이상 반복되고 배경·테두리·반경·패딩이 있는 상자를 카드 후보로 봄');
    if (list.length > kept.length) reasons.push(`변형 ${list.length}개 중 많이 쓰인 ${kept.length}개만 냄`);
    reasons.push('이름(primary·secondary·ghost…)은 규칙으로 붙인 제안: 채움=primary, 테두리만=secondary, 둘 다 없음=ghost');
    components.push({
      id: compId,
      kind,
      detectedBy,
      instances,
      variants,
      ...(heights.size ? { sizes: [...heights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, n]) => ({ height: { value: h, unit: 'px' as const }, count: n })) } : {}),
      reasons,
      confidence: kind === 'card' ? 0.35 : detectedBy.includes('ax-role') ? round(Math.min(0.9, 0.5 + 0.1 * Math.log2(instances + 1)), 2) : 0.5,
    });
  }
  return { components, ringColors, variantOfElement };
}

function mostCommon(xs: number[]): number | null {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function diffState(a: StateProps, b: StateProps, ref: (c: Rgba | null) => string): Record<string, string> {
  const d: Record<string, string> = {};
  const same = (x: Rgba | null, y: Rgba | null) => (x === null && y === null) || (!!x && !!y && colorKey(x) === colorKey(y));
  for (const [field, prop] of STATE_PROPS) {
    const x = a[field];
    const y = b[field];
    if (field === 'bg' || field === 'fg' || field === 'border') {
      if (!same(x as Rgba | null, y as Rgba | null)) d[prop] = `${ref(x as Rgba | null)} -> ${ref(y as Rgba | null)}`;
    } else if (field === 'outline') {
      if (!same(x as Rgba | null, y as Rgba | null) || a.outlineWidth !== b.outlineWidth) {
        const f = (c: Rgba | null, w: number) => (c && w > 0 ? `${w}px ${ref(c)}` : 'none');
        d[prop] = `${f(a.outline, a.outlineWidth)} -> ${f(b.outline, b.outlineWidth)}`;
      }
    } else if (field === 'shadow') {
      if (x !== y) d[prop] = `${x === 'none' ? 'none' : 'shadow'} -> ${y === 'none' ? 'none' : 'shadow'}`;
    } else if (x !== y) {
      d[prop] = `${String(x).slice(0, 40)} -> ${String(y).slice(0, 40)}`;
    }
  }
  if (d['box-shadow'] === 'shadow -> shadow') d['box-shadow'] = 'changed';
  // transform values like matrix(...) contain parentheses but no braces or semicolons.
  return d;
}

export type { State };
