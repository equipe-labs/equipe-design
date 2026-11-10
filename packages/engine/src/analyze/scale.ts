import type { Scale } from '@equipe-design/schema';
import { round } from './color.ts';

export interface ScaleInput {
  value: number;
  count: number;
  sections: number;
  /** Declared by a CSS variable from a length-only group (e.g. --space-1…). */
  declared: boolean;
  full?: boolean;
}

const near = (v: number, steps: number[], tol = 0.5) => steps.some((s) => Math.abs(s - v) <= tol);

/**
 * Spacing / radius scale (README 2.6).
 * 1. A group of length-only variables, when there is one, gives the steps.
 * 2. Otherwise the base b ∈ {2, 4, 8} with the highest weighted share of multiples
 *    (ties → bigger b), and steps = multiples of b seen ≥ 3 times in ≥ 2 sections.
 * Everything else becomes an outlier with its reason; nothing is silently dropped.
 */
export function inferScale(values: ScaleInput[], kind: 'spacing' | 'radius'): Scale {
  const reasons: string[] = [];
  const pool = values.filter((v) => !v.full && v.value > 0);
  const total = pool.reduce((a, v) => a + v.count, 0);
  const declared = [...new Set(values.filter((v) => v.declared && !v.full).map((v) => v.value))].sort((a, b) => a - b);
  const declaredSet = new Set(declared);
  const hasFull = values.some((v) => v.full);

  const share = (b: number) => (total ? pool.reduce((a, v) => a + (Math.abs(v.value / b - Math.round(v.value / b)) * b <= 0.5 ? v.count : 0), 0) / total : 0);
  let base = 4;
  let bestShare = -1;
  for (const b of [2, 4, 8]) {
    const s = share(b);
    if (s > bestShare + 0.05 || (Math.abs(s - bestShare) <= 0.05 && b > base)) {
      base = b;
      bestShare = s;
    }
  }
  if (declared.length >= 3) {
    const g = declared.reduce((a, b) => gcd(a, b));
    if (g >= 2) base = g >= 8 ? 8 : g >= 4 ? 4 : 2;
  }
  const isMultiple = (v: number) => Math.abs(v / base - Math.round(v / base)) * base <= 0.5;

  let steps: number[];
  const observedSteps = pool.filter((v) => isMultiple(v.value) && v.count >= 3 && v.sections >= 2).map((v) => v.value);
  if (kind === 'spacing' && declared.length >= 3) {
    steps = declared;
    reasons.push(`길이만 담은 CSS 변수 묶음이 ${declared.length}단계를 선언함`);
  } else if (kind === 'radius') {
    const seen = new Set(pool.filter((v) => v.count > 0).map((v) => v.value));
    const used = declared.filter((v) => seen.has(v));
    if (used.length >= 3) {
      // A real group of radius variables, most of it used: the group is the scale. Framework
      // defaults declare more sizes than a page draws, so declared sizes no element used stay out,
      // and values outside the group are outliers, as for spacing.
      steps = used;
      reasons.push(`CSS 변수 묶음이 ${declared.length}단계를 선언했고 그중 ${used.length}단계(${used.join(', ')}px)를 요소가 씀`);
      const unused = declared.filter((v) => !seen.has(v));
      if (unused.length) reasons.push(`선언만 되고 이 페이지 요소가 쓰지 않은 ${unused.join(', ')}px는 단계에서 뺌`);
    } else {
      // Radius variables are often few (two or three named sizes); observed steps add to them.
      steps = [...new Set([...declared, ...observedSteps])].sort((a, b) => a - b);
      if (declared.length) reasons.push(`CSS 변수가 ${declared.length}단계(${declared.join(', ')}px)를 선언함`);
      const extra = observedSteps.filter((v) => !declaredSet.has(v));
      if (extra.length) reasons.push(`${extra.join(', ')}px는 ${base}의 배수이고 3회 이상, 2개 이상 구역에서 나옴`);
    }
  } else {
    steps = [...new Set(observedSteps)].sort((a, b) => a - b);
    reasons.push(`기준 단위 ${base}px: 관찰값의 ${Math.round(bestShare * 100)}%(가중)가 ${base}의 배수`, `단계는 ${base}의 배수 중 3회 이상, 2개 이상 구역에서 나온 값`);
  }
  const fit = total ? pool.reduce((a, v) => a + (near(v.value, steps) ? v.count : 0), 0) / total : 0;
  if (kind === 'spacing' && declared.length >= 3) reasons.push(`관찰 간격의 ${Math.round(fit * 100)}%(가중)가 이 단계 중 하나와 ±0.5px 안`);
  if (hasFull) reasons.push("높이의 절반 이상인 값(알약·원)은 'full'로 따로 분류");

  const outliers = pool
    .filter((v) => v.count > 0 && !near(v.value, steps))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((v) => ({
      value: v.value,
      count: v.count,
      reason: !isMultiple(v.value)
        ? `${base}의 배수가 아님`
        : v.count < 3
          ? `${v.count}회만 나옴`
          : v.sections < 2
            ? '한 구역에서만 나옴'
            : '변수 묶음에 없는 값',
    }));

  const confidence = round(Math.min(1, (declared.length >= 3 ? 0.5 : 0.25) + 0.5 * fit), 2);
  return {
    base: { value: base, unit: 'px' },
    steps,
    fit: round(fit, 3),
    ...(kind === 'radius' ? { full: hasFull } : {}),
    outliers,
    reasons,
    confidence,
  };
}

function gcd(a: number, b: number): number {
  a = Math.round(a);
  b = Math.round(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

const RATIOS = [1.067, 1.125, 1.2, 1.25, 1.333, 1.414, 1.5, 1.618];

/** Font-size steps; a modular ratio only when it fits ≥ 0.8 of the steps. */
export function inferFontScale(sizes: { value: number; count: number }[], body: number | null): Scale {
  const steps = [...new Set(sizes.filter((s) => s.count >= 2).map((s) => s.value))].sort((a, b) => a - b);
  const reasons: string[] = [`글자 크기 ${steps.length}단계(2회 이상 나온 크기)`];
  let ratio: number | null = null;
  let bestFit = 0;
  if (body && steps.length >= 3) {
    for (const r of RATIOS) {
      const fit = steps.filter((s) => {
        const n = Math.round(Math.log(s / body) / Math.log(r));
        return Math.abs(body * r ** n - s) / s <= 0.05;
      }).length / steps.length;
      if (fit > bestFit) {
        bestFit = fit;
        ratio = r;
      }
    }
  }
  if (bestFit < 0.8) {
    reasons.push(`모듈러 비율 적합도가 낮아(${round(bestFit, 2)}) 비율 대신 관찰 단계만 냄`);
    ratio = null;
  } else reasons.push(`본문 ${body}px 기준 비율 ${ratio} 적합도 ${round(bestFit, 2)}`);
  const outliers = sizes.filter((s) => s.count < 2).slice(0, 20).map((s) => ({ value: s.value, count: s.count, reason: '1회만 나옴' }));
  return { ...(body ? { base: { value: body, unit: 'px' as const } } : {}), steps, fit: round(bestFit, 3), ratio, outliers, reasons, confidence: round(0.4 + 0.4 * Math.min(1, steps.length / 6), 2) };
}
