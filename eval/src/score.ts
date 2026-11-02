/** The metrics of design README 5.2, one function each; each returns a scoreboard cell. */
import { chroma, hasColor, sameColor, toHex } from './color.ts';
import type { Answer, Cell, MetricName, ToolResult } from './types.ts';

const NA: Cell = { text: '–' };

function ratio(hit: number, total: number): string {
  return `${hit}/${total}`;
}

function frac(text: string, hit: number, total: number, goal?: number): Cell {
  return { text, pass: goal === undefined || total === 0 ? undefined : hit / total >= goal };
}

/** Answer colours used on the page whose light value the tool reported; dark misses listed by name. */
export function scoreColors(a: Answer, r: ToolResult): Cell {
  const items = (a.colors?.items ?? []).filter((i) => i.usedOnPage !== false && i.light);
  if (!items.length) return NA;
  const hit = items.filter((i) => hasColor(r.colors, i.light!));
  const darkPool = r.darkColors?.length ? r.darkColors : r.colors;
  const darkMiss = items.filter((i) => i.dark && hasColor(r.colors, i.light!) && !hasColor(darkPool, i.dark)).map((i) => i.name);
  const lightMiss = items.filter((i) => !hit.includes(i)).map((i) => i.name);
  const notes = [
    lightMiss.length ? `누락 ${lightMiss.slice(0, 4).join('·')}${lightMiss.length > 4 ? ` 외 ${lightMiss.length - 4}` : ''}` : '',
    a.dark && a.dark.method !== 'none' && a.dark.method !== 'dark-only' && darkMiss.length ? `다크 ${darkMiss.slice(0, 3).join('·')} 누락` : '',
  ].filter(Boolean);
  return {
    text: ratio(hit.length, items.length) + (notes.length ? ` (${notes.join(', ')})` : ''),
    pass: hit.length === items.length && darkMiss.length === 0,
  };
}

/**
 * Unique opaque answer (light, dark) pairs the tool reproduced — all of them, used on the page or
 * not (the design's 17 for equipe.im). Precision = the tool's own pairs that are right.
 */
export function scoreDarkPairs(a: Answer, r: ToolResult, goal = 0.88): Cell {
  const want = new Map<string, { light: string; dark: string }>();
  for (const i of a.colors?.items ?? []) {
    const l = toHex(i.light);
    const d = toHex(i.dark);
    // Translucent overlays (#rrggbbaa) are left out: their pair depends on what is underneath.
    if (!l || !d || i.light!.length > 7 || i.dark!.length > 7) continue;
    want.set(`${l}/${d}`, { light: l, dark: d });
  }
  if (!want.size) return NA;
  if (r.pairs === null) return { text: '쌍 없음', pass: false };
  const ok = (p: { light: string; dark: string }, q: { light: string; dark: string }) => sameColor(p.light, q.light) && sameColor(p.dark, q.dark);
  const recall = [...want.values()].filter((w) => r.pairs!.some((p) => ok(p, w))).length;
  const right = r.pairs.filter((p) => [...want.values()].some((w) => ok(p, w))).length;
  const label = r.pairsLabel ? `, ${r.pairsLabel}` : '';
  return frac(`${ratio(recall, want.size)} · 맞은 쌍 ${ratio(right, r.pairs.length)}${label}`, recall, want.size, goal);
}

/** For answer colours with a role and a dark value: did the tool give the same dark value (by variable, then by role)? */
export function scoreDarkRoles(a: Answer, r: ToolResult, goal = 0.9): Cell {
  const items = (a.colors?.items ?? []).filter((i) => i.dark && i.role);
  if (!items.length) return NA;
  if (!r.darkByVar && !r.darkByRole) return { text: '다크 값 없음', pass: false };
  let hit = 0;
  let same = 0;
  const miss: string[] = [];
  for (const i of items) {
    const byVar = i.var ? r.darkByVar?.[i.var] : undefined;
    const got = byVar ?? r.darkByRole?.[i.role === 'muted-text' ? 'muted-text' : i.role!] ?? null;
    if (sameColor(got, i.dark)) hit++;
    else {
      miss.push(`${i.var ?? i.role} ${got ?? '없음'}`);
      const light = i.var ? r.lightByVar?.[i.var] : undefined;
      if (got && light && sameColor(got, light)) same++;
    }
  }
  const why = same ? `라이트=다크 ${same}개` : miss.length ? miss.slice(0, 2).join(', ') : '';
  return frac(`${hit === items.length ? '✓' : '✗'} ${ratio(hit, items.length)}${why ? ` (${why})` : ''}`, hit, items.length, goal);
}

function scale(want: number[] | undefined, got: number[] | null, count: number | undefined, goals?: { recall: number; precision: number }): Cell {
  if (!want?.length) return NA;
  if (!got) return { text: '출력 없음', pass: false };
  const setGot = new Set(got);
  const recall = want.filter((w) => setGot.has(w)).length;
  const denom = count ?? got.length;
  const precise = got.filter((g) => want.includes(g)).length;
  const p = denom ? precise / denom : 0;
  return {
    text: `${ratio(recall, want.length)} · ${ratio(precise, denom)}`,
    pass: goals ? recall / want.length >= goals.recall && p >= goals.precision : undefined,
  };
}

export const scoreSpacing = (a: Answer, r: ToolResult) => scale(a.spacing?.px, r.spacing, undefined, { recall: 1, precision: 0.75 });
export const scoreRadius = (a: Answer, r: ToolResult) => scale(a.radius?.px, r.radius, r.radiusCount, { recall: 0.8, precision: 0.6 });

const norm = (f: string) => f.toLowerCase().replace(/["']/g, '').replace(/\s+(variable|fallback)$/, '').trim();

export function scoreTypography(a: Answer, r: ToolResult): Cell {
  const fams = a.typography?.families ?? [];
  const sizes = a.typography?.fontSizesPx ?? [];
  if (!fams.length && !sizes.length) return NA;
  if (!r.families) return { text: '출력 없음', pass: false };
  const got = new Set(r.families.map(norm));
  const fh = fams.filter((f) => got.has(norm(f))).length;
  const extra = r.families.filter((f) => !fams.some((w) => norm(w) === norm(f))).length;
  let text = `글꼴 ${ratio(fh, fams.length)}${extra ? ` (+${extra})` : ''}`;
  let pass = fh === fams.length;
  if (sizes.length && r.fontSizes) {
    const sh = sizes.filter((s) => r.fontSizes!.includes(s)).length;
    text += ` · 크기 ${ratio(sh, sizes.length)}`;
    pass = pass && sh / sizes.length >= 0.8;
  }
  return { text, pass };
}

/** ✓ same colour (or `none` when the answer is none), △ uncertain with the right top candidate — or a grey when the answer is none — ✗ otherwise. */
export function scoreBrand(a: Answer, r: ToolResult): Cell {
  if (!a.brand) return NA;
  if (!r.brand) return { text: '출력 없음', pass: false };
  const want = a.brand.value;
  const b = r.brand;
  const shown = b.status === 'none' ? '`none`' : b.color ? `\`${b.color}\`` : `\`${b.status}\``;
  if (want === 'none') {
    if (b.status === 'none') return { text: '✓ `none`', pass: true };
    if (b.status === 'uncertain' || (b.color && chroma(b.color) < 0.04)) return { text: `△ ${b.status === 'uncertain' ? `uncertain ${b.top ?? ''}`.trim() : shown}`, pass: false };
    return { text: `✗ ${shown}`, pass: false };
  }
  if (b.status === 'found' && sameColor(b.color, want)) return { text: `✓ ${shown}`, pass: true };
  if (b.status === 'uncertain' && sameColor(b.top, want)) return { text: `△ uncertain, 1위 \`${b.top}\``, pass: false };
  return { text: `✗ ${shown}`, pass: false };
}

export function scoreDarkOnly(a: Answer, r: ToolResult): Cell {
  if (a.dark?.method !== 'dark-only') return NA;
  if (r.darkOnly === null) return { text: '– (판정 없음)' };
  return r.darkOnly ? { text: '✓', pass: true } : { text: '✗', pass: false };
}

export const METRIC_LABEL: Record<MetricName, string> = {
  colors: '색 적중 (페이지에 쓰인 정답 색)',
  darkPairs: '다크 쌍 재현율 · 맞은 쌍',
  darkRoles: '다크 변수·역할 값',
  spacing: '간격 재현율 · 정밀도',
  radius: '반경 재현율 · 정밀도',
  typography: '타이포',
  brand: '브랜드색',
  darkOnly: 'dark-only 판정',
};

export function score(metric: MetricName, a: Answer, r: ToolResult): Cell {
  if (r.status === 'missing') return { text: '–' };
  if (r.status === 'stopped') return { text: `멈춤 (${r.error})`, pass: false };
  switch (metric) {
    case 'colors': return scoreColors(a, r);
    case 'darkPairs': return scoreDarkPairs(a, r);
    case 'darkRoles': return scoreDarkRoles(a, r);
    case 'spacing': return scoreSpacing(a, r);
    case 'radius': return scoreRadius(a, r);
    case 'typography': return scoreTypography(a, r);
    case 'brand': return scoreBrand(a, r);
    case 'darkOnly': return scoreDarkOnly(a, r);
  }
}
