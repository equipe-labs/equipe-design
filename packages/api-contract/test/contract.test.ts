import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateExtraction } from '@equipe-design/schema';
import { loadSource } from '@equipe-design/remix';
import {
  LibraryFile, Limit, Meta, TRANSLATED_LOCALES, ReleaseList, ReleaseUpload, RemixRequest, RemixResponse, StyleDetail, StyleList, TokenFiles,
  localized, slugFromName,
} from '../src/index.ts';
import { FIXTURES_DIR, INPUTS, buildFixtures, serialize } from './build-fixtures.ts';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '..', '..');
const fixtures = buildFixtures();
const onDisk = (p: string) => readFileSync(join(FIXTURES_DIR, p), 'utf8');
const json = (p: string) => JSON.parse(onDisk(p)) as unknown;

const openapi = parse(readFileSync(join(pkg, 'openapi.yaml'), 'utf8')) as { components: { schemas: Record<string, unknown> } };
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
ajv.addSchema({ components: openapi.components }, 'openapi');
const oas = (name: string) => ajv.getSchema(`openapi#/components/schemas/${name}`)!;

/** Fixture path pattern -> [zod type, OpenAPI schema name]. */
const PUBLIC: [RegExp, { parse: (v: unknown) => unknown }, string][] = [
  [/^public\/styles\.json$/, StyleList, 'StyleList'],
  [/^public\/styles\/[a-z0-9-]+\.json$/, StyleDetail, 'StyleDetail'],
  [/^public\/styles\/[a-z0-9-]+\/releases\.json$/, ReleaseList, 'ReleaseList'],
  [/^public\/releases\/[0-9a-f-]+\/tokens\/[a-z-]+\.json$/, TokenFiles, 'TokenFiles'],
  [/^public\/meta\.json$/, Meta, 'Meta'],
  [/^public\/remix\.request\.json$/, RemixRequest, 'RemixRequest'],
  [/^public\/remix\.response\.json$/, RemixResponse, 'RemixResponse'],
];

describe('openapi.yaml', () => {
  it('passes redocly lint', () => {
    const out = execFileSync(join(root, 'node_modules', '.bin', 'redocly'), ['lint', 'openapi.yaml', '--format=stylish'], { cwd: pkg, encoding: 'utf8', stdio: 'pipe' });
    expect(out).not.toMatch(/warning|error/);
  });

  it('lists error responses and a Cache-Control header on every path', () => {
    const doc = parse(readFileSync(join(pkg, 'openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, { responses?: Record<string, { headers?: Record<string, unknown> }> }>> };
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        if (!op.responses) continue;
        const codes = Object.keys(op.responses);
        expect(codes.some((c) => c.startsWith('4')), `${method} ${path} has no 4xx`).toBe(true);
        expect(codes, `${method} ${path}`).toContain('500');
        const ok = codes.find((c) => /^[23]/.test(c) && c !== '304')!;
        expect(op.responses[ok]!.headers?.['Cache-Control'], `${method} ${path} ${ok}`).toBeDefined();
      }
    }
  });
});

describe('fixtures', () => {
  it('are current (npm run gen:fixtures -w @equipe-design/api-contract)', () => {
    for (const [p, v] of Object.entries(fixtures)) expect(onDisk(p), p).toBe(serialize(v));
  });

  it('hold two originals and one extracted style', () => {
    const lib = LibraryFile.parse(json('admin/library.json'));
    expect(lib.map((e) => [e.slug, e.origin])).toEqual([['hush', 'original'], ['klaxon', 'original'], ['tessel', 'extracted']]);
  });

  it('public files pass both the zod type and the OpenAPI schema', () => {
    let n = 0;
    for (const p of Object.keys(fixtures).filter((k) => k.startsWith('public/'))) {
      const match = PUBLIC.find(([re]) => re.test(p));
      expect(match, `no type for ${p}`).toBeDefined();
      const [, zodType, name] = match!;
      const value = json(p);
      expect(() => zodType.parse(value), p).not.toThrow();
      const v = oas(name);
      expect(v(value), `${p}: ${JSON.stringify(v.errors?.slice(0, 3))}`).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(3 * 5 + 7);
  });

  it('uploads pass the zod type and the OpenAPI schema; the extract passes @equipe-design/schema', () => {
    for (const { slug, entry } of INPUTS) {
      const upload = ReleaseUpload.parse(json(`admin/uploads/${slug}.json`));
      expect(upload.origin).toBe(entry.origin);
      expect(oas('ReleaseUpload')(upload), JSON.stringify(oas('ReleaseUpload').errors?.slice(0, 3))).toBe(true);
      if (upload.origin === 'extracted') {
        const r = validateExtraction(upload.extract);
        expect(r.ok, JSON.stringify(!r.ok && r.issues.slice(0, 3))).toBe(true);
      }
    }
    for (const e of LibraryFile.parse(json('admin/library.json'))) {
      const upsert: Record<string, unknown> = { ...e };
      delete upsert.slug;
      expect(oas('StyleUpsert')(upsert), JSON.stringify(oas('StyleUpsert').errors)).toBe(true);
    }
  });

  it('carry description and every limit in all eight site languages', () => {
    for (const { slug } of INPUTS) {
      const d = StyleDetail.parse(json(`public/styles/${slug}.json`));
      expect(Object.keys(d.style.descriptionI18n).sort(), slug).toEqual([...TRANSLATED_LOCALES].sort());
      expect(d.release.limits.length, slug).toBeGreaterThan(0);
      for (const l of d.release.limits) {
        expect(Object.keys(l.textI18n).sort(), `${slug} ${l.scope}`).toEqual([...TRANSLATED_LOCALES].sort());
        // `text` is the English fallback: no Hangul or kana in it.
        expect(l.text, `${slug} ${l.scope}`).not.toMatch(/[\u3040-\u30ff\uac00-\ud7af]/);
      }
      expect(d.style.description).not.toMatch(/[\u3040-\u30ff\uac00-\ud7af]/);
    }
  });

  it('picks the locale text, else the English field', () => {
    expect(localized('Quiet', { ko: '조용한' }, 'ko')).toBe('조용한');
    expect(localized('Quiet', { ko: '조용한' }, 'ja')).toBe('Quiet');
    expect(localized('Quiet', { ko: '조용한' }, 'en')).toBe('Quiet');
    expect(Limit.safeParse({ scope: '*', text: 'x', textI18n: { en: 'x' } }).success).toBe(false);
    expect(Limit.safeParse({ scope: '*', text: 'x', textI18n: { pt: 'x' } }).success).toBe(false);
    expect(oas('Limit')({ scope: '*', text: 'x', textI18n: { en: 'x' } })).toBe(false);
  });

  it('original styles are T-291 tokens the remix engine reads', () => {
    for (const f of ['hush', 'klaxon']) {
      expect(loadSource(json(`inputs/${f}.tokens.json`)).kind).toBe('library');
    }
  });
});

describe('request checks', () => {
  const ok = json('public/remix.request.json') as Record<string, unknown>;
  const bad: [string, Record<string, unknown>][] = [
    ['4 sources', { ...ok, sources: [{ style: 'hush' }, { style: 'hush' }, { style: 'hush' }, { style: 'hush' }] }],
    ['no source', { ...ok, sources: [] }],
    ['4 variants', { ...ok, variants: 4 }],
    ['bad colour', { ...ok, brand: { color: '#FFF' } }],
    ['33-char prefix', { ...ok, prefix: 'a'.repeat(33) }],
    ['keepBrand', { ...ok, keepBrand: true }],
    ['figma remix', { ...ok, formats: ['figma'] }],
  ];
  for (const [what, body] of bad) {
    it(`POST /remix refuses ${what}`, () => {
      expect(RemixRequest.safeParse(body).success).toBe(false);
      expect(oas('RemixRequest')(body)).toBe(false);
    });
  }

  it('style slugs come from our style name', () => {
    expect(slugFromName('Hush')).toBe('hush');
    expect(slugFromName('Night Owl')).toBe('night-owl');
    const lib = json('admin/library.json') as Record<string, unknown>[];
    expect(LibraryFile.safeParse([{ ...lib[2], slug: 'equipe-im' }]).success).toBe(false);
  });

  it('an extracted style needs its source and an original must not have one', () => {
    const lib = json('admin/library.json') as Record<string, unknown>[];
    const { source, ...noSource } = lib[2]!;
    expect(LibraryFile.safeParse([noSource]).success).toBe(false);
    expect(LibraryFile.safeParse([{ ...lib[0], source }]).success).toBe(false);
    const other = { ...(source as object), allowedUrls: ['https://elsewhere.example/'] };
    expect(LibraryFile.safeParse([{ ...lib[2], source: other }]).success).toBe(false);
  });
});
