import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Extraction } from '@equipe-design/schema';
import { checkAnswer, loadAnswer, loadSites, staleDays } from '../src/answers.ts';
import { equipeResult } from '../src/adapters.ts';
import { deltaE, hasColor, scanColors, toHex } from '../src/color.ts';
import { runEval } from '../src/run.ts';
import { score, scoreBrand, scoreColors, scoreDarkPairs } from '../src/score.ts';
import type { Answer, ToolResult } from '../src/types.ts';

const example = JSON.parse(
  readFileSync(new URL('../../packages/schema/examples/equipe.im.json', import.meta.url), 'utf8'),
) as Extraction;

describe('colour helpers', () => {
  it('normalises hex and rgb and drops alpha', () => {
    expect(toHex('#FFF')).toBe('#ffffff');
    expect(toHex('#0A0A0C24')).toBe('#0a0a0c');
    expect(toHex('rgb(29, 78, 216)')).toBe('#1d4ed8');
    expect(toHex('oklch(0.5 0 0)')).toBeNull();
  });
  it('scans colours out of any text', () => {
    expect([...scanColors('a{color:#ABC;background:rgba(1,2,3,.5)} #12345678')].sort()).toEqual(['#010203', '#123456', '#aabbcc']);
  });
  it('matches within ΔE_OK 0.02', () => {
    expect(deltaE('#ffffff', '#ffffff')).toBe(0);
    expect(hasColor(['#1d4ed8'], '#1d4ed9')).toBe(true);
    expect(hasColor(['#1d4ed8'], '#8fb0ff')).toBe(false);
  });
});

describe('answers', () => {
  it('every site has an answer with a source on each section and a checkedAt', () => {
    for (const s of loadSites()) {
      const a = loadAnswer(s.host);
      expect(a, s.host).not.toBeNull();
      expect(checkAnswer(a!), s.host).toEqual([]);
    }
  });
  it('flags answers older than 30 days', () => {
    const a = loadAnswer('equipe.im')!;
    expect(staleDays(a, new Date(`${a.checkedAt}T12:00:00Z`))).toBe(0);
    expect(staleDays(a, new Date(Date.parse(a.checkedAt) + 31 * 86_400_000))).toBe(31);
  });
});

describe('scoring the schema example (engine stand-in)', () => {
  const a = loadAnswer('equipe.im')!;
  const r = equipeResult(example, 'equipe.im');
  it('reads scales, brand and fonts', () => {
    expect(score('spacing', a, r).text).toBe('9/9 · 9/9');
    expect(score('radius', a, r).text).toBe('5/5 · 5/5');
    expect(score('brand', a, r)).toEqual({ text: '✓ `#1d4ed8`', pass: true });
    expect(score('typography', a, r).text).toBe('글꼴 2/2');
  });
  it('scores a variable by the colour it resolves to, not its declared text', () => {
    const x = structuredClone(example);
    const v = x.observed.variables.find((w) => w.resolvesTo?.light && w.resolvesTo.dark)!;
    v.values = { light: 'lab(0% 0 0)', dark: 'lab(98.26% 0 0)' };
    const byId = new Map(x.observed.color.map((c) => [c.id, c.value.hex.toLowerCase().slice(0, 7)]));
    const res = equipeResult(x, 'equipe.im');
    expect(res.darkByVar![v.name]).toBe(byId.get(v.resolvesTo!.dark!));
    expect(res.lightByVar![v.name]).toBe(byId.get(v.resolvesTo!.light!));
  });
  it('a stopped run scores as stopped, not zero', () => {
    expect(score('colors', a, { ...r, status: 'stopped', error: 'robots-disallowed' }).text).toBe('멈춤 (robots-disallowed)');
  });
});

describe('dark pairs on the page', () => {
  const items = [
    { name: 'bg', light: '#ffffff', dark: '#000000' },
    { name: 'text', light: '#111111', dark: '#eeeeee' },
    { name: 'raised', light: '#ffffff', dark: '#222222', pairOnPage: false },
    { name: 'err', light: '#ff0000', dark: '#ff8888', usedOnPage: false },
  ];
  const dark = { method: 'media', source: 'x' } as const;
  const marked = { dark, colors: { source: 'x', items } } as Answer;
  const unmarked = { dark, colors: { source: 'x', items: items.map(({ name, light, dark }) => ({ name, light, dark })) } } as Answer;
  const r = {
    colors: ['#ffffff', '#111111', '#000000', '#eeeeee'],
    darkColors: ['#000000', '#eeeeee'],
    pairs: [
      { light: '#ffffff', dark: '#000000' },
      { light: '#111111', dark: '#eeeeee' },
    ],
  } as ToolResult;
  it('leaves marked pairs out of the denominator and says how many', () => {
    expect(scoreDarkPairs(marked, r)).toEqual({ text: '2/2 (페이지 밖 2쌍 제외) · 맞은 쌍 2/2', pass: true });
  });
  it('scores unmarked answers as before', () => {
    expect(scoreDarkPairs(unmarked, r)).toEqual({ text: '2/4 · 맞은 쌍 2/2', pass: false });
  });
  it('counts a tool pair matching an off-page answer pair as right', () => {
    const more = { ...r, pairs: [...r.pairs!, { light: '#ffffff', dark: '#222222' }] } as ToolResult;
    expect(scoreDarkPairs(marked, more).text).toBe('2/2 (페이지 밖 2쌍 제외) · 맞은 쌍 3/3');
  });
  it('does not name off-page dark values as colour misses', () => {
    expect(scoreColors(marked, r)).toEqual({ text: '3/3', pass: true });
    expect(scoreColors(unmarked, r).text).toBe('3/4 (누락 err, 다크 raised 누락)');
  });
  it('equipe.im counts 11 pairs on the page', () => {
    const a = loadAnswer('equipe.im')!;
    const all = a.colors!.items.filter((i) => i.light && i.dark && i.light.length <= 7 && i.dark.length <= 7);
    const pairs = all.filter((i) => i.pairOnPage !== false).map((i) => ({ light: i.light!, dark: i.dark! }));
    expect(scoreDarkPairs(a, { pairs } as ToolResult).text).toMatch(/^11\/11 \(페이지 밖 6쌍 제외\) · /);
  });
});

describe('brand rule', () => {
  const none = { brand: { source: 'x', value: 'none' } } as Answer;
  const red = { brand: { source: 'x', value: '#ff6363' } } as Answer;
  const r = (brand: ToolResult['brand']) => ({ brand }) as ToolResult;
  it('✓ / △ / ✗', () => {
    expect(scoreBrand(none, r({ status: 'none', color: null })).text).toBe('✓ `none`');
    expect(scoreBrand(none, r({ status: 'found', color: '#d0d6e0' })).text).toBe('△ `#d0d6e0`');
    expect(scoreBrand(none, r({ status: 'found', color: '#e4f222' })).text).toBe('✗ `#e4f222`');
    expect(scoreBrand(red, r({ status: 'uncertain', color: null, top: '#ff6363' })).text).toMatch(/^△/);
    expect(scoreBrand(red, r({ status: 'found', color: '#ffc531' })).text).toBe('✗ `#ffc531`');
  });
});

// T-257's raw outputs are not in this repo (they hold other sites' values): point EQUIPE_T257_DIR at them.
const T257 = process.env.EQUIPE_T257_DIR ?? '';

describe.skipIf(!T257 || !existsSync(T257) || !readdirSync(T257).includes('designlang'))('re-scoring T-257 reproduces its numbers', () => {
  it('designlang and Dembrandt cells match the design README 5.3 table', async () => {
    const out = join(tmpdir(), `eq-eval-${process.pid}`);
    const r = await runEval({ from: T257, out, sites: ['equipe.im', 'ui.shadcn.com', 'linear.app', 'raycast.com'] });
    const cell = (host: string, metric: string, tool: 'designlang' | 'dembrandt') =>
      r.sites.find((s) => s.host === host)!.rows.find((x) => x.metric === metric)!.cells[tool].text;
    expect(cell('equipe.im', 'spacing', 'designlang')).toBe('4/9 · 4/23');
    expect(cell('equipe.im', 'spacing', 'dembrandt')).toBe('9/9 · 9/20');
    expect(cell('equipe.im', 'radius', 'designlang')).toBe('1/5 · 1/10');
    expect(cell('equipe.im', 'radius', 'dembrandt')).toBe('4/5 · 4/15');
    expect(cell('equipe.im', 'darkPairs', 'designlang')).toContain('맞은 쌍 9/24');
    expect(cell('equipe.im', 'darkPairs', 'dembrandt')).toBe('쌍 없음');
    expect(cell('equipe.im', 'colors', 'designlang')).toMatch(/^21\/21/);
    expect(cell('equipe.im', 'colors', 'dembrandt')).toMatch(/^21\/21/);
    expect(cell('ui.shadcn.com', 'darkRoles', 'designlang')).toMatch(/^✗ .*라이트=다크/);
    expect(cell('ui.shadcn.com', 'darkRoles', 'dembrandt')).toMatch(/^✗ .*--background #ffffff/);
    expect(cell('linear.app', 'brand', 'designlang')).toBe('✗ `#e4f222`');
    expect(cell('linear.app', 'brand', 'dembrandt')).toBe('△ `#d0d6e0`');
    expect(cell('raycast.com', 'brand', 'designlang')).toBe('✗ `#ffc531`');
    expect(cell('raycast.com', 'brand', 'dembrandt')).toBe('✓ `#ff6363`');
  });
});
