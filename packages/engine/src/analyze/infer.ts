import type { Brand, Mode, Role, TypeRole } from '@equipe-design/schema';
import type { Rgba } from '../capture/inpage.ts';
import { chroma, contrast, deltaE, hueFamily, lightness, over, round, toHex } from './color.ts';
import { sampleKey, type Sample } from './model.ts';
import type { ColorRecord, Observation } from './observe.ts';

// Interpretation: roles with light/dark pairs, brand colour, type roles. Every result
// carries the reasons it was chosen; empty roles stay empty.

const byId = (o: Observation) => new Map(o.colors.map((c) => [c.id, c]));

/** Majority dark colour for a set of light samples (same element path, same property). */
function darkFor(o: Observation, samples: Sample[], to: Mode): { id: string | null; agree: number } {
  const votes = new Map<string, number>();
  let total = 0;
  for (const s of samples) {
    const id = o.assign[to].get(sampleKey(s));
    total++;
    if (id) votes.set(id, (votes.get(id) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? { id: best[0], agree: total ? best[1] / total : 0 } : { id: null, agree: 0 };
}

export interface RoleContext {
  obs: Observation;
  primary: Mode;
  other: Mode | null;
  darkLimit: string | null;
  brand: Brand;
  /** colour id -> component variant names using it as background (filled buttons). */
  buttons: { bg: string | null; fg: string | null; border: string | null; count: number; kind: string; name: string }[];
  ring: string | null;
}

export function inferRoles(ctx: RoleContext): Role[] {
  const { obs, primary, other } = ctx;
  const ids = byId(obs);
  const prim = obs.colors.filter((c) => c.mode === primary && c.elements.size > 0);
  const bgRgba = obs.pageBackground[primary] ?? [255, 255, 255, 1];
  const usage = new Map(obs.variables.map((v) => [v.name, v.usedByElements]));
  const roles: Role[] = [];
  const used = new Set<string>();

  const pair = (role: Role['role'], rec: ColorRecord | null, reasons: string[], confidence: number, samples?: Sample[], alternatives: string[] = []) => {
    let light: string | null = null;
    let dark: string | null = null;
    let agree = 0;
    if (rec) {
      const s = samples ?? rec.samples;
      const varName = [...rec.variables].sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a.localeCompare(b))[0];
      if (varName) reasons.push(`변수 이름 ${varName}`);
      let otherId: string | null = null;
      if (other) {
        const d = darkFor(obs, s, other);
        otherId = d.id;
        agree = d.agree;
        // A variable that names this role and resolves in the other mode is a stronger signal.
        const v = obs.variables.find((x) => x.resolvesTo?.[primary] === rec.id && x.resolvesTo?.[other]);
        if (v && (!otherId || agree < 0.6)) {
          otherId = v.resolvesTo![other]!;
          reasons.push(`다른 모드 값은 변수 ${v.name}에서`);
        } else if (otherId) reasons.push(`다른 모드에서 같은 자리 요소의 ${Math.round(agree * 100)}%가 같은 색`);
      }
      if (primary === 'light') {
        light = rec.id;
        dark = otherId;
      } else {
        dark = rec.id;
        light = otherId;
      }
      used.add(rec.id);
    } else reasons.push('페이지에서 이 역할로 쓰인 색을 찾지 못함');
    const r: Role = { role, light, dark, reasons, alternatives: alternatives.filter((a) => a !== rec?.id).slice(0, 3), confidence: rec ? round(Math.min(1, confidence * (other && !(primary === 'light' ? dark : light) ? 0.85 : 1)), 2) : 0 };
    if (rec && other === null && ctx.darkLimit) r.limit = ctx.darkLimit;
    if (rec && other && !(primary === 'light' ? dark : light) && ctx.darkLimit) r.limit = ctx.darkLimit;
    roles.push(r);
    return r;
  };
  const top = (list: ColorRecord[], score: (c: ColorRecord) => number) => [...list].map((c) => [c, score(c)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);

  // background
  const bgRec = prim.find((c) => c.id === obs.colorFor(primary, bgRgba)) ?? null;
  const bgSamples = bgRec ? bgRec.samples.filter((s) => s.prop === 'background-color' && (s.path === '' || /^\d+$/.test(s.path))) : [];
  pair('background', bgRec, [bgRec ? `페이지(body/html) 배경${bgRec.observed.areaShare ? `, 면적 ${Math.round(bgRec.observed.areaShare * 100)}%` : ''}` : ''].filter(Boolean), 0.9, bgSamples.length ? bgSamples : undefined);

  // text: most common text colour outside links and decoration
  // Weighted by the box area of the text, so many tiny labels don't outvote the body copy.
  const textScore = (c: ColorRecord) => c.textArea;
  const texts = top(prim, textScore);
  const textRec = texts[0]?.[0] ?? null;
  const textTotal = texts.reduce((a, [, v]) => a + v, 0) || 1;
  pair('text', textRec, textRec ? [`글자 면적 기준 최빈 글자색(${Math.round((texts[0]![1] / textTotal) * 100)}%, ${textRec.uses.text.size}개 요소)`] : [], 0.85, textRec?.samples.filter((s) => s.prop === 'color'), texts.slice(1, 3).map(([c]) => c.id));

  // muted-text: next text colour, achromatic, lower contrast than text but still readable
  const textContrast = textRec ? contrast(over(textRec.rgba, bgRgba), bgRgba) : 21;
  const muted = texts.slice(1).find(([c]) => chroma(c.rgba) < 0.06 && contrast(over(c.rgba, bgRgba), bgRgba) < textContrast && contrast(over(c.rgba, bgRgba), bgRgba) >= 2.5)?.[0] ?? null;
  pair('muted-text', muted, muted ? ['글자색 중 본문보다 대비가 낮은 무채색 최빈값'] : [], 0.7, muted?.samples.filter((s) => s.prop === 'color'));

  // surface / raised: large non-interactive backgrounds other than the page background
  const surfaceScore = (c: ColorRecord) => (c.id === bgRec?.id || c.rgba[3] < 0.9 || chroma(c.rgba) >= 0.06 || c.uses.background.size < 2 ? 0 : c.area);
  const surfaces = top(prim, surfaceScore).filter(([c]) => c.area > 4000);
  const surface = surfaces[0]?.[0] ?? null;
  pair('surface', surface, surface ? [`페이지 배경 외 상자 배경 중 면적이 가장 큰 색(${surface.uses.background.size}개 요소)`] : [], 0.6, surface?.samples.filter((s) => s.prop === 'background-color'), surfaces.slice(1, 3).map(([c]) => c.id));
  const raised = surfaces.slice(1).find(([c]) => lightness(c.rgba) > lightness(surface?.rgba ?? bgRgba) || primary === 'dark')?.[0] ?? null;
  pair('raised', raised && raised.id !== surface?.id ? raised : null, raised ? ['두 번째로 많은 상자 배경(띄운 면 후보)'] : [], 0.4, raised?.samples.filter((s) => s.prop === 'background-color'));

  // primary / on-primary / secondary: filled buttons
  const filled = ctx.buttons.filter((b) => b.kind === 'button' && b.bg && b.bg !== bgRec?.id).sort((a, b) => b.count - a.count);
  const prRec = filled[0]?.bg ? (ids.get(filled[0].bg) ?? null) : null;
  pair('primary', prRec, prRec ? [`채운 버튼 중 가장 많이 쓰인 변형의 배경(${filled[0]!.count}개)`] : [], 0.75, prRec?.samples.filter((s) => s.prop === 'background-color'));
  const onPr = filled[0]?.fg ? (ids.get(filled[0].fg) ?? null) : null;
  pair('on-primary', onPr, onPr ? ['그 버튼의 글자색'] : [], 0.7, onPr?.samples.filter((s) => s.prop === 'color'));
  const sec = filled.find((b) => b.bg !== filled[0]?.bg);
  const secRec = sec?.bg ? (ids.get(sec.bg) ?? null) : null;
  pair('secondary', secRec, secRec ? ['배경이 다른 두 번째 채운 버튼의 배경'] : [], 0.5, secRec?.samples.filter((s) => s.prop === 'background-color'));

  // accent: the brand colour when there is one
  const accRec = ctx.brand.color ? (ids.get(ctx.brand.color) ?? null) : ctx.brand.status === 'uncertain' && ctx.brand.candidates[0] ? (ids.get(ctx.brand.candidates[0].color) ?? null) : null;
  pair('accent', accRec, accRec ? [ctx.brand.status === 'found' ? '브랜드색으로 판정된 색' : '브랜드 후보 1위(불확실)'] : ['브랜드색이 없다고 판정됨'], ctx.brand.status === 'found' ? 0.8 : 0.4);

  // border / border-strong
  const borders = top(prim, (c) => c.uses.border.size);
  const border = borders[0]?.[0] ?? null;
  pair('border', border, border ? [`테두리 최빈색(${borders[0]![1]}개 요소)`] : [], 0.75, border?.samples.filter((s) => s.prop.startsWith('border')), borders.slice(1, 3).map(([c]) => c.id));
  const bc = (c: ColorRecord) => contrast(over(c.rgba, bgRgba), bgRgba);
  const strong = borders.slice(1).find(([c]) => border && bc(c) > bc(border) * 1.3 && chroma(c.rgba) < 0.06)?.[0] ?? null;
  pair('border-strong', strong, strong ? ['테두리색 중 최빈값보다 대비가 뚜렷한 무채색'] : [], 0.5, strong?.samples.filter((s) => s.prop.startsWith('border')));

  // ring: focus outline from forced :focus-visible, else any outline colour
  const ringRec = ctx.ring ? (ids.get(ctx.ring) ?? null) : (top(prim, (c) => c.uses.outline.size)[0]?.[0] ?? null);
  pair('ring', ringRec, ringRec ? [ctx.ring ? ':focus-visible 강제 시 외곽선 색 최빈값' : '외곽선(outline) 색'] : [], ctx.ring ? 0.75 : 0.4);

  // status colours by hue family, low confidence
  const status = (role: Role['role'], fam: string[], why: string) => {
    const cands = top(prim.filter((c) => fam.includes(hueFamily(c.rgba)) && c.rgba[3] >= 0.5 && c.id !== accRec?.id && !used.has(c.id)), (c) => c.elements.size + (c.variables.size ? 2 : 0));
    const rec = cands[0]?.[0] ?? null;
    pair(role, rec, rec ? [why] : [], 0.35);
  };
  status('destructive', ['red'], '빨강 계열에서 가장 많이 쓰인 색(색상각만 본 약한 추정)');
  status('success', ['green', 'teal'], '초록 계열에서 가장 많이 쓰인 색(색상각만 본 약한 추정)');
  status('warning', ['orange', 'yellow'], '주황·노랑 계열에서 가장 많이 쓰인 색(색상각만 본 약한 추정)');
  return roles;
}

const NAME_STRONG = /brand|primary|accent/i;
const NAME_WEAK = /link|highlight|theme|key|focus|ring/i;

/** README 2.7: brand colour by use (buttons, links, focus, spread), not by saturation. */
export function inferBrand(o: Observation, mode: Mode, ctx: { themeColor: Rgba | null; variantsOf: Map<string, Set<string>>; ringColors: Map<string, number> }): Brand {
  const cands = o.colors.filter((c) => c.mode === mode && c.elements.size > 0 && c.rgba[3] >= 0.5 && chroma(c.rgba) >= 0.06);
  const scored = cands.map((c) => {
    let interactive = c.interactive.size / Math.max(1, c.elements.size);
    if (ctx.ringColors.has(c.id)) interactive = Math.min(1, interactive + 0.3);
    const sections = c.sections.size;
    const clusters = ctx.variantsOf.get(c.id)?.size ?? 0;
    const names = [...c.variables];
    const variableName = names.some((n) => NAME_STRONG.test(n)) ? 1 : names.some((n) => NAME_WEAK.test(n)) ? 0.5 : 0;
    const variety = ['background', 'text', 'border', 'outline'].filter((k) => c.uses[k as keyof ColorRecord['uses']].size > 0).length;
    const usageVariety = Math.min(1, variety / 3);
    const themeColorMeta = ctx.themeColor && deltaE(ctx.themeColor, c.rgba) < 0.02 ? 1 : 0;
    // Identity: the colour of the logo (home link at the top) or of <meta name=theme-color>.
    const logo = c.home.size > 0 ? 1 : 0;
    const identity = Math.max(themeColorMeta, logo);
    const decorativeOnly = c.decorative.size >= c.elements.size && logo === 0;
    // One card, one illustration, or fewer than three elements: not a system-wide colour.
    const singleSubtree = sections <= 1 || c.elements.size < 3;
    const spread = singleSubtree ? 0 : Math.min(1, 0.6 * Math.min(1, sections / 4) + 0.4 * Math.min(1, clusters / 3));
    let score = 0.3 * interactive + 0.2 * spread + 0.15 * variableName + 0.1 * usageVariety + 0.25 * identity;
    if (singleSubtree) score *= 0.3;
    if (decorativeOnly) score *= 0.5;
    return {
      rec: c,
      cand: {
        color: c.id,
        score: round(score, 3),
        signals: {
          interactiveUse: round(interactive, 3),
          spread: round(spread, 3),
          variableName,
          usageVariety: round(usageVariety, 3),
          themeColorMeta: identity,
          decorativeOnly,
          singleSubtree,
        },
      },
    };
  });
  scored.sort((a, b) => b.cand.score - a.cand.score);
  const first = scored[0];
  const second = scored[1];
  const reasons: string[] = [];
  const candidates = scored.slice(0, 5).map((s) => s.cand);
  if (!first) {
    return { status: 'none', color: null, candidates: [], reasons: ['유채색(OKLCH C ≥ 0.06)이 페이지에 없음 — 무채색 사이트'], confidence: 0.8 };
  }
  const describe = (s: (typeof scored)[number]) =>
    `${toHex(s.rec.rgba)}: 점수 ${s.cand.score} (상호작용 ${s.cand.signals.interactiveUse}, 퍼짐 ${s.cand.signals.spread}, 변수 이름 ${s.cand.signals.variableName}, 로고·theme-color ${s.cand.signals.themeColorMeta}, 구역 ${s.rec.sections.size}개${s.cand.signals.singleSubtree ? ', 한 구역에만 있거나 3개 미만이라 ×0.3' : ''})`;
  reasons.push(`1위 ${describe(first)}`);
  if (second) reasons.push(`2위 ${describe(second)}`);
  const gap = first.cand.score - (second?.cand.score ?? 0);
  const identityLead = first.cand.signals.themeColorMeta === 1 && first.cand.score >= 0.4 && gap >= 0.25;
  if ((first.cand.score >= 0.5 && gap >= 0.15) || identityLead) {
    reasons.push(identityLead && first.cand.score < 0.5 ? '1위가 로고·theme-color 색이고 0.4 이상, 2위와 0.25 이상 차이 → found' : '1위가 0.5 이상이고 2위와 0.15 이상 차이 → found');
    return { status: 'found', color: first.rec.id, candidates, reasons, confidence: round(Math.min(0.95, 0.5 + first.cand.score / 2), 2) };
  }
  if (first.cand.score < 0.35 || (first.cand.signals.interactiveUse === 0 && first.cand.signals.themeColorMeta === 0)) {
    reasons.push(first.cand.score < 0.35 ? '1위 점수가 0.35 미만 → 브랜드색 없음' : '1위가 버튼·링크·포커스에 쓰이지 않음 → 브랜드색 없음');
    return { status: 'none', color: null, candidates, reasons, confidence: round(Math.min(0.9, 0.5 + (0.35 - Math.min(0.35, first.cand.score))), 2) };
  }
  reasons.push('1위와 2위 차이가 작거나 점수가 애매함 → 사람이 리믹스에서 고름');
  return { status: 'uncertain', color: null, candidates: candidates.slice(0, 3), reasons, confidence: 0.4 };
}

export function inferTypeRoles(o: Observation): TypeRole[] {
  const s = o.styles;
  const tagged = (tag: string) => [...s].filter((x) => (x.tags?.[tag] ?? 0) > 0).sort((a, b) => (b.tags![tag] ?? 0) - (a.tags![tag] ?? 0))[0] ?? null;
  const out: TypeRole[] = [];
  const add = (role: TypeRole['role'], st: (typeof s)[number] | null, reason: string, conf: number) =>
    out.push({ role, style: st?.id ?? null, reasons: st ? [reason] : ['해당하는 글자 스타일을 찾지 못함'], confidence: st ? conf : 0 });
  const largest = [...s].sort((a, b) => b.size.value - a.size.value)[0] ?? null;
  add('display', largest, `가장 큰 글자 스타일(${largest?.size.value}px)`, 0.6);
  add('h1', tagged('h1'), 'h1에 가장 많이 쓰인 스타일', 0.75);
  add('h2', tagged('h2'), 'h2에 가장 많이 쓰인 스타일', 0.75);
  add('h3', tagged('h3'), 'h3에 가장 많이 쓰인 스타일', 0.7);
  const isMono = (x: (typeof s)[number]) => /mono|code|courier|menlo|consolas/i.test(x.family) || o.families.find((f) => f.name === x.family)?.generic === 'monospace';
  const bodyCands = [...s].filter((x) => !isMono(x)).sort((a, b) => ((b.tags?.p ?? 0) + (b.tags?.li ?? 0)) * 2 + b.count - (((a.tags?.p ?? 0) + (a.tags?.li ?? 0)) * 2 + a.count));
  const body = bodyCands[0] ?? null;
  add('body', body, '문단(p·li)과 전체 글자에서 가장 많이 쓰인 스타일', 0.75);
  const small = body ? ([...s].filter((x) => !isMono(x) && x.size.value < body.size.value).sort((a, b) => b.count - a.count)[0] ?? null) : null;
  add('small', small, '본문보다 작은 스타일 중 최빈값', 0.6);
  add('mono', [...s].filter(isMono).sort((a, b) => b.count - a.count)[0] ?? null, '고정폭 글꼴 스타일 중 최빈값', 0.7);
  return out;
}
