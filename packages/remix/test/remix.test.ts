import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, loadSource, remix, RemixError, toOklch } from '../src/index.ts';

const example = JSON.parse(readFileSync(new URL('../../schema/examples/equipe.im.json', import.meta.url), 'utf8'));
const lib = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.tokens.json`, import.meta.url), 'utf8'));
const BRAND = '#0f766e';

describe('remix', () => {
  it('turns the T0 example into 3 variants with the new brand colour and no AA failures', () => {
    const src = loadSource(example);
    const out = remix([src], { color: BRAND, name: 'acme' });
    expect(out.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    for (const r of out) {
      expect(r.meta.brand.applied).toBe(BRAND);
      expect(r.model.colors.light.accent).not.toBe(src.brand.light);
      expect(r.model.colors.light.accent).toBe(BRAND);
      expect(r.contrast.fails).toEqual([]);
      expect(r.contrast.checked).toBeGreaterThan(30);
    }
    // the variants really differ
    expect(new Set(out.map((r) => JSON.stringify(r.model.colors))).size).toBe(3);
  });

  it('composites a translucent border over the background instead of using its raw colour', () => {
    const r = remix([loadSource(example)], { color: BRAND, name: 'acme' })[0]!;
    expect(contrast(r.model.colors.light.border, r.model.colors.light.background)).toBeLessThan(2);
  });

  it('refuses --keep-brand without --own-site, and with both keeps the colour and records it', () => {
    const src = loadSource(example);
    expect(() => remix([src], { name: 'acme' }, { keepBrand: true })).toThrow(RemixError);
    expect(() => remix([src], { name: 'acme' }, { keepBrand: true })).toThrow(/own-site/);
    const out = remix([src], { name: 'acme' }, { keepBrand: true, ownSite: true, variants: 1 });
    expect(out[0]!.model.colors.light.primary).toBe(src.brand.light);
    expect(out[0]!.meta.brand).toMatchObject({ kept: true, ownSite: true, requested: null, applied: src.brand.light });
  });

  it('remixes library systems (Hush, Klaxon, Gilt) with 0 AA failures', () => {
    for (const n of ['Hush', 'Klaxon', 'Gilt']) {
      const out = remix([loadSource(lib(n))], { color: BRAND, name: 'acme' });
      expect(out).toHaveLength(3);
      for (const r of out) {
        expect(r.contrast.fails, `${n} ${r.id}`).toEqual([]);
        expect(r.model.colors.dark).not.toBeNull();
      }
      expect(out[2]!.model.colors.light.primary).not.toBe(loadSource(lib(n)).model.colors.light.primary);
    }
  });

  it('moves a failing colour only as far as needed, and records it', () => {
    const out = remix([loadSource(lib('Hush'))], { color: '#ffe066', name: 'acme' });
    for (const r of out) {
      expect(r.contrast.fails).toEqual([]);
      const a = r.meta.adjustments.find((x) => x.role === 'accent' && x.mode === 'light');
      expect(a).toBeDefined();
      expect(toOklch(a!.to).h).toBeCloseTo(toOklch('#ffe066').h, -1);
    }
  });

  it('mixes sources role by role and says which one supplied what', () => {
    const out = remix([loadSource(lib('Hush')), loadSource(lib('Klaxon')), loadSource(lib('Gilt'))], { color: BRAND, name: 'acme' });
    expect(out.map((r) => r.meta.mix)).toEqual([{ colors: 0, type: 1, shape: 2 }, { colors: 1, type: 2, shape: 0 }, { colors: 2, type: 0, shape: 1 }]);
    expect(out[0]!.model.fonts.sans[0]).toBe(loadSource(lib('Klaxon')).model.fonts.sans[0]);
  });

  it('swaps non-OFL fonts only with --font-alt', () => {
    const x = structuredClone(example);
    x.observed.typography.families[0].name = 'Helvetica Neue';
    x.observed.typography.families[0].license = 'proprietary';
    const src = loadSource(x);
    expect(remix([src], { color: BRAND, name: 'a' })[0]!.model.fonts.sans[0]).toBe('Helvetica Neue');
    const r = remix([src], { color: BRAND, name: 'a' }, { fontAlt: true })[0]!;
    expect(r.model.fonts.sans[0]).toBe('Inter');
    expect(r.meta.fonts[0]).toMatchObject({ from: 'Helvetica Neue', to: 'Inter' });
  });

  it('rejects a bad brand colour and input that is not tokens', () => {
    expect(() => remix([loadSource(example)], { color: 'teal', name: 'a' })).toThrow(/hex/);
    expect(() => loadSource({ hello: 1 })).toThrow(/not an extract/);
  });
});
