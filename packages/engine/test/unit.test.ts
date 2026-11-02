import { describe, expect, it } from 'vitest';
import { matchRobots, parseRobots, planPages } from '../src/index.ts';
import { deltaE, parseHex, rgbToOklch, toHex } from '../src/analyze/color.ts';
import { inferScale } from '../src/analyze/scale.ts';
import { detectWall } from '../src/guard/session.ts';
import { parseShadow, parseRgbString } from '../src/analyze/observe.ts';

describe('robots.txt parsing (RFC 9309)', () => {
  const txt = `
User-agent: *
Disallow: /private/
Allow: /private/ok$
Disallow: /*.json$

User-agent: equipe-design
User-agent: other
Disallow: /app/
`;
  it('uses the group for our token over *', () => {
    const rules = parseRobots(txt);
    expect(matchRobots(rules, '/app/x').allowed).toBe(false);
    expect(matchRobots(rules, '/private/x').allowed).toBe(true);
  });
  it('falls back to *, longest match wins, Allow wins ties, * and $ work', () => {
    const rules = parseRobots(txt, 'somebot');
    expect(matchRobots(rules, '/private/x').allowed).toBe(false);
    expect(matchRobots(rules, '/private/ok').allowed).toBe(true);
    expect(matchRobots(rules, '/private/ok/more').allowed).toBe(false);
    expect(matchRobots(rules, '/data/a.json').allowed).toBe(false);
    expect(matchRobots(rules, '/data/a.json?x').allowed).toBe(true);
    expect(matchRobots(rules, '/').allowed).toBe(true);
  });
  it('an empty Disallow allows everything', () => {
    expect(matchRobots(parseRobots('User-agent: *\nDisallow:\n'), '/x').allowed).toBe(true);
  });
});

describe('page budget', () => {
  it('keeps five URLs on the first origin', () => {
    const p = planPages(['a.com/1', 'a.com/2', 'b.com/', 'a.com/3', 'a.com/4', 'a.com/5', 'a.com/6']);
    expect(p.accepted.map((u) => u.pathname)).toEqual(['/1', '/2', '/3', '/4', '/5']);
    expect(p.otherOrigin).toEqual(['https://b.com/']);
    expect(p.overCap).toEqual(['https://a.com/6']);
  });
});

describe('login and bot walls', () => {
  const check = { passwordFields: 0, textLength: 5000, challenge: false, forms: 0, elements: 800 };
  const u = new URL('https://x.test/pricing');
  it('stops on a password page, a redirect to /login, a challenge', () => {
    expect(detectWall({ status: 200, requestedUrl: u, finalUrl: u, check: { ...check, passwordFields: 1, textLength: 300, elements: 40 } }).wall).toBe('login-required');
    expect(detectWall({ status: 200, requestedUrl: u, finalUrl: new URL('https://x.test/login?next=/pricing'), check }).wall).toBe('login-required');
    expect(detectWall({ status: 403, requestedUrl: u, finalUrl: u, check: { ...check, challenge: true } }).wall).toBe('bot-challenge');
  });
  it('lets a normal page with a small sign-in box through', () => {
    expect(detectWall({ status: 200, requestedUrl: u, finalUrl: u, check: { ...check, passwordFields: 1 } }).wall).toBeNull();
  });
});

describe('colour', () => {
  it('converts to OKLCH and back to hex', () => {
    const [L, C, H] = rgbToOklch(parseHex('#1d4ed8')!);
    expect(L).toBeCloseTo(0.488, 2);
    expect(C).toBeCloseTo(0.217, 2);
    expect(H).toBeCloseTo(264.4, 0);
    expect(toHex(parseHex('#1D4ED8')!)).toBe('#1d4ed8');
    expect(parseHex('#0a0a0c24')![3]).toBeCloseTo(0.141, 2);
  });
  it('ΔE separates near neighbours only below 0.02', () => {
    expect(deltaE(parseHex('#16171a')!, parseHex('#17171c')!)).toBeLessThan(0.02);
    expect(deltaE(parseHex('#1d4ed8')!, parseHex('#2e5cde')!)).toBeGreaterThan(0.02);
  });
  it('parses computed box-shadow lists', () => {
    const v = parseShadow('rgba(0, 0, 0, 0.22) 0px 8px 24px -4px, rgba(0, 0, 0, 0.1) 0px 2px 6px 0px', parseRgbString)!;
    expect(v).toHaveLength(2);
    expect(v[0]).toEqual({ offsetX: 0, offsetY: 8, blur: 24, spread: -4, color: { hex: '#000000', alpha: 0.22 }, inset: false });
  });
});

describe('scales', () => {
  const v = (value: number, count: number, sections = 3, declared = false) => ({ value, count, sections, declared, full: false });
  it('takes a length-only variable group as the spacing steps', () => {
    const s = inferScale([v(4, 10, 3, true), v(8, 30, 3, true), v(16, 20, 3, true), v(24, 0, 0, true), v(13, 2)], 'spacing');
    expect(s.steps).toEqual([4, 8, 16, 24]);
    expect(s.outliers![0]).toMatchObject({ value: 13, reason: '4의 배수가 아님' });
  });
  it('without variables, keeps multiples of the base seen ≥3 times in ≥2 sections', () => {
    const s = inferScale([v(4, 10), v(8, 30), v(12, 2), v(16, 20, 1), v(24, 9), v(7, 5)], 'spacing');
    expect(s.base!.value).toBe(4);
    expect(s.steps).toEqual([4, 8, 24]);
    expect(s.outliers!.map((o) => o.value).sort((a, b) => a - b)).toEqual([7, 12, 16]);
  });
  it('keeps pill radii out of the steps', () => {
    const s = inferScale([v(8, 10, 3, true), v(12, 5, 3, true), { ...v(9999, 7), full: true }, v(6, 4)], 'radius');
    expect(s.steps).toEqual([6, 8, 12]);
    expect(s.full).toBe(true);
  });
});
