import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSource, remix } from '@equipe-design/remix';
import { describe, expect, it } from 'vitest';
import { EmitError, FORMATS, emit, resolveFiles, toDtcg, type DtcgFiles } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(readFileSync(join(here, '../../schema/examples/equipe.im.json'), 'utf8'));
const first = () => remix([loadSource(example)], { color: '#0f766e', name: 'acme' }, { variants: 1 })[0]!;
const all = (files: DtcgFiles) => emit(files, [...FORMATS]);
const have = (cmd: string) => spawnSync('which', [cmd]).status === 0;

describe('toDtcg (2025.10)', () => {
  const files = toDtcg(first());
  it('writes the three layers, with dark and light holding the same keys', () => {
    expect(Object.keys(files).sort()).toEqual(['component.json', 'primitive.json', 'semantic.color.dark.json', 'semantic.color.light.json', 'semantic.json']);
    const keys = (f: string) => Object.keys((files[f]!.color as Record<string, unknown>)).sort();
    expect(keys('semantic.color.dark.json')).toEqual(keys('semantic.color.light.json'));
  });
  it('uses colour objects and {value, unit} dimensions, and every reference resolves', () => {
    const prim = JSON.stringify(files['primitive.json']);
    expect(prim).toContain('"colorSpace":"srgb"');
    expect(prim).toContain('"unit":"px"');
    const r = resolveFiles(files);
    expect(r.light.find((t) => t.name === 'color.primary')!.ref).toMatch(/^color\.raw\./);
    expect(r.dark).not.toBeNull();
  });
  it('keeps where a role came from, as ids only', () => {
    const light = files['semantic.color.light.json']!.color as Record<string, { $extensions?: Record<string, { source: string }> }>;
    expect(light.background!.$extensions!['im.equipe.design']!.source).toBe('c1');
  });
  it('leaves the dark file out when the source has no dark colours (nothing is invented)', () => {
    const x = structuredClone(example);
    for (const r of x.inferred.roles) r.dark = null;
    const f = toDtcg(loadSource(x).model);
    expect(f['semantic.color.dark.json']).toBeUndefined();
    expect(emit(f, ['css'])['tokens.css']).not.toContain('prefers-color-scheme');
  });
});

describe('guard: a source label in a name', () => {
  it('fails emit when a token name has the source host label', () => {
    const files = structuredClone(toDtcg(first()));
    const prim = files['primitive.json'] as Record<string, Record<string, unknown>>;
    prim.color!.raw = { 'equipe-blue': (prim.color!.raw as Record<string, unknown>).teal ?? {} };
    expect(() => emit(files, ['css'], { forbidden: ['equipe.im', 'equipe'] })).toThrow(EmitError);
    expect(() => emit(files, ['css'], { forbidden: ['equipe'] })).toThrow(/equipe/);
  });
  it('fails when a file name has it, and passes clean output', () => {
    const files = toDtcg(first());
    expect(() => emit({ ...files, 'equipe.json': {} }, ['css'], { forbidden: ['equipe'] })).toThrow(/file name/);
    expect(() => emit(files, [...FORMATS], { forbidden: first().forbiddenLabels })).not.toThrow();
    expect(first().forbiddenLabels).toContain('equipe');
  });
});

describe('formats', () => {
  const out = all(toDtcg(first()));
  it('css: variables with the prefix, dark by media query and data-theme', () => {
    const css = out['tokens.css']!;
    expect(css).toContain('--eq-color-primary: #0f766e;');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(emit(toDtcg(first()), ['css'], { prefix: 'acme' })['tokens.css']).toContain('--acme-color-primary');
  });
  it('tailwind v4: @theme with colour roles and a .dark override', () => {
    const t = out['theme.css']!;
    expect(t).toContain('@import "tailwindcss";');
    expect(t).toMatch(/@theme \{[\s\S]*--color-primary: #0f766e;/);
    expect(t).toMatch(/\.dark \{[\s\S]*--color-background:/);
  });
  it('shadcn: --background is white in light mode for a site whose busiest colour is grey (T-257)', () => {
    const x = structuredClone(example);
    const grey = structuredClone(x.observed.color[0]);
    grey.id = 'c99';
    grey.value = { hex: '#e8e8e8', oklch: [0.93, 0, 0], alpha: 1 };
    grey.count = 5000;
    grey.areaShare = 0.9;
    x.observed.color.push(grey);
    x.inferred.roles[0].light = 'c1';
    x.observed.color[0].value.hex = '#ffffff';
    const files = toDtcg(loadSource(x).model);
    const oklch = emit(files, ['shadcn'])['shadcn.css']!;
    expect(oklch).toMatch(/:root \{\n {2}--background: oklch\(1 0 0\);/);
    const hsl = emit(files, ['shadcn'], { shadcnFormat: 'hsl' })['shadcn.css']!;
    expect(hsl).toMatch(/:root \{\n {2}--background: 0 0% 100%;/);
    expect(hsl).toContain('.dark {');
  });
  it('swift: type-checks with swiftc', () => {
    if (!have('swiftc')) return;
    const dir = mkdtempSync(join(tmpdir(), 'eqd-swift-'));
    try {
      writeFileSync(join(dir, 'Tokens.swift'), out['EqTokens.swift']!);
      execFileSync('swiftc', ['-typecheck', join(dir, 'Tokens.swift')], { stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
  it.skipIf(!have('kotlinc'))('kotlin: compiles with kotlinc against Compose stubs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eqd-kt-'));
    try {
      writeFileSync(join(dir, 'Tokens.kt'), out['EqTokens.kt']!);
      const stubs = join(here, 'fixtures/compose-stubs');
      execFileSync('kotlinc', [join(dir, 'Tokens.kt'), ...readdirSync(stubs).map((f) => join(stubs, f)), '-d', join(dir, 'out')], { stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
  it('kotlin: has the explicit-API shape (package, classes, light and dark)', () => {
    const kt = out['EqTokens.kt']!;
    expect(kt).toContain('package design.tokens');
    expect(kt).toContain('public class EqColors(');
    expect(kt).toContain('public val Dark: EqColors');
    expect(kt).toMatch(/Color\(0xFF0F766E\)/);
  });
});

describe('--dtcg-legacy', () => {
  const legacy = emit(toDtcg(first()), ['dtcg'], { legacy: true });
  it('writes strings like "4px" in equipe\'s five files', () => {
    expect(Object.keys(legacy).sort()).toEqual(['dtcg/component.json', 'dtcg/primitive.json', 'dtcg/semantic.color.dark.json', 'dtcg/semantic.color.light.json', 'dtcg/semantic.json', 'tokens.json']);
    expect(legacy['dtcg/primitive.json']).toMatch(/"\$value": "\d+px"/);
    expect(legacy['dtcg/semantic.color.light.json']).toMatch(/"action": \{\s+"\$value": "#0f766e"/);
  });

  // tokens.json as equipe's design/scripts/build.mjs writes it: one tree, light in $value, dark in $extensions.mode.dark.
  type Node = { $value?: unknown; $extensions?: { mode?: { dark?: unknown } }; [k: string]: unknown };
  const tokensJson = JSON.parse(legacy['tokens.json']!) as Record<string, Node>;
  const at = (name: string): Node => name.split('.').reduce<Node>((n, k) => n[k] as Node, tokensJson as Node);
  const value = (name: string, dark: boolean): string => {
    const n = at(name);
    const v = (dark && n.$extensions?.mode && 'dark' in n.$extensions.mode ? n.$extensions.mode.dark : n.$value) as string;
    const ref = /^\{(.+)\}$/.exec(v);
    return ref ? value(ref[1]!, dark) : v;
  };
  it('writes the one tokens.json equipe reads: light as $value, dark in $extensions.mode.dark, aliases kept', () => {
    expect(at('color.bg').$value).toMatch(/^#[0-9a-f]{6}$/);
    expect(at('color.bg').$extensions?.mode?.dark).toMatch(/^#[0-9a-f]{6}$/);
    expect(at('color.bg').$extensions?.mode?.dark).not.toBe(at('color.bg').$value);
    expect(at('badge.ok-bg').$value).toBe('{color.ok-bg}');
    expect(at('badge.ok-bg').$extensions).toBeUndefined();
    expect(Object.keys(at('color')).at(-1)).toBe('raw');
    expect(value('space.4', false)).toMatch(/px$/);
  });
  // The same measure as `equipe design check`: a component's text on its own fill, laid over the page.
  const rgb = (hex: string) => [1, 3, 5, 7].map((i) => (i < 7 || hex.length > 7 ? parseInt(hex.slice(i, i + 2), 16) : 255));
  const lum = ([r, g, b]: number[]) => [r!, g!, b!].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const over = (fg: number[], bg: number[]) => fg.slice(0, 3).map((v, i) => Math.round(v * (fg[3]! / 255) + bg[i]! * (1 - fg[3]! / 255))).concat(255);
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
  it.each([false, true])('component text reads AA on its own fill (badges, chips, buttons) — dark %s', (dark) => {
    const page = over(rgb(value('color.bg', dark)), [255, 255, 255, 255]);
    const misses: string[] = [];
    for (const group of ['badge', 'chip', 'button']) {
      for (const leaf of Object.keys(at(group))) {
        const stem = /^(.*)-fg$/.exec(leaf)?.[1] ?? (leaf === 'fg' ? '' : null);
        const fill = stem === null ? undefined : [stem ? `${stem}-bg` : 'bg'].find((f) => f in at(group));
        if (!fill) continue;
        const r = ratio(over(rgb(value(`${group}.${leaf}`, dark)), over(rgb(value(`${group}.${fill}`, dark)), page)), over(rgb(value(`${group}.${fill}`, dark)), page));
        if (r < 4.5) misses.push(`${group}.${leaf} ${r.toFixed(2)}`);
      }
    }
    expect(misses).toEqual([]);
  });
  it.skipIf(!have('equipe'))('`equipe design check` reads it and passes tokens, dark and contrast', () => {
    for (const id of ['a', 'b']) {
      const r = remix([loadSource(example)], { color: '#0f766e', name: 'Tidewater' }, { variants: 2 }).find((x) => x.id === id)!;
      const dir = mkdtempSync(join(tmpdir(), 'eqd-check-'));
      try {
        writeFileSync(join(dir, 'tokens.json'), emit(toDtcg(r), ['dtcg'], { legacy: true })['tokens.json']!);
        const res = spawnSync('equipe', ['design', 'check', '--json', dir], { encoding: 'utf8' });
        const findings = JSON.parse(res.stdout) as { level: string; area: string; message: string }[];
        const errors = findings.filter((f) => f.level === 'error' && ['tokens', 'dark', 'contrast'].includes(f.area));
        expect(errors, id).toEqual([]);
        expect(findings.filter((f) => f.area === 'contrast' && f.level === 'ok')).toHaveLength(2);
        expect(findings.some((f) => f.area === 'dark' && f.level === 'ok')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  const equipeDesign = join(process.env.HOME ?? '', 'Abel/equipe/design');
  const canBuild = existsSync(join(equipeDesign, 'scripts/build.mjs')) && existsSync(join(process.env.EQUIPE_DESIGN_NODE_MODULES ?? '/tmp/eqbuild', 'node_modules/style-dictionary'));
  it.skipIf(!canBuild)("equipe's design/scripts/build.mjs builds CSS, Swift and Kotlin from it", () => {
    const dir = mkdtempSync(join(tmpdir(), 'eqd-legacy-'));
    try {
      for (const f of ['scripts', 'package.json']) cpSync(join(equipeDesign, f), join(dir, f), { recursive: true });
      cpSync(join(process.env.EQUIPE_DESIGN_NODE_MODULES ?? '/tmp/eqbuild', 'node_modules'), join(dir, 'node_modules'), { recursive: true });
      mkdirSync(join(dir, 'tokens'));
      for (const [name, text] of Object.entries(legacy)) if (name.startsWith('dtcg/')) writeFileSync(join(dir, 'tokens', name.replace('dtcg/', '')), text);
      execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: dir, stdio: 'pipe' });
      for (const f of ['build/css/tokens.css', 'build/swift/EquipeTokens.swift', 'build/kotlin/EquipeTokens.kt']) expect(existsSync(join(dir, f)), f).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
