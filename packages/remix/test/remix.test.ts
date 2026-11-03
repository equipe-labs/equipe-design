import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, loadSource, over, remix, RemixError, sunkenOf, tintAlpha, TINT_FLOOR, toOklch } from '../src/index.ts';
import { fixContrast } from '../src/contrast.ts';

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

  it("measures badge and chip text on its own tint and the sunken well, and moves the colour until it reads", () => {
    for (const r of remix([loadSource(example)], { color: BRAND, name: 'acme' })) {
      for (const mode of ['light', 'dark'] as const) {
        const c = r.model.colors[mode]!;
        for (const role of ['accent', 'success', 'warning', 'destructive'] as const) {
          const a = tintAlpha(c, role);
          expect(a).toBeGreaterThanOrEqual(TINT_FLOOR);
          for (const bg of [c.background]) expect(contrast(c[role], over(c[role], Math.round(a * 255) / 255, bg)), `${r.id} ${mode} ${role}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(c['muted-text'], sunkenOf(c, mode))).toBeGreaterThanOrEqual(4.5);
      }
      expect(r.contrast.pairs.some((p) => p.bg === 'success tint on background')).toBe(true);
    }
    // The brand colour reads on white but not on its own 14% tint: the tint lightens, the colour stays.
    const a = remix([loadSource(example)], { color: BRAND, name: 'acme' })[0]!;
    expect(a.model.colors.light.accent).toBe(BRAND);
    expect(tintAlpha(a.model.colors.light, 'accent')).toBeLessThan(0.14);
  });

  it('moves the colour only when even the lightest tint is not enough', () => {
    const c = { ...remix([loadSource(example)], { color: BRAND, name: 'acme' })[0]!.model.colors.light, background: '#ffffff', surface: '#ffffff' };
    c.success = '#767676'; // 4.54:1 on white: passes the page, not a 6% tint of itself
    expect(tintAlpha(c, 'success')).toBe(TINT_FLOOR);
    const moved = fixContrast(c, {}, 'light').find((x) => x.role === 'success');
    expect(moved?.reason).toMatch(/success tint on background/);
    expect(contrast(c.success, over(c.success, Math.round(TINT_FLOOR * 255) / 255, '#ffffff'))).toBeGreaterThanOrEqual(4.5);
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
