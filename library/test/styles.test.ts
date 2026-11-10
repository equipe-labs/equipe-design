// library/styles.json (L6) is public: our names, slugs and token paths only. Where an extracted
// style came from lives in a private sources.json outside this repository, joined by id; the
// publisher (L2) reads it from EQUIPE_DESIGN_SOURCES and these tests do too when it is set.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { Category, LibraryFile, Origin, Slug, StyleName, Tag } from '../../packages/api-contract/src/index.ts';

const lib = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(lib, '..');

const PublicEntry = z.object({
  id: z.union([Slug, z.string().regex(/^ext-\d{2}$/)]),
  slug: Slug,
  name: StyleName,
  origin: Origin,
  description: z.string().max(280),
  category: Category,
  tags: z.array(Tag).max(12),
  tokens: z.string().regex(/^originals\/[a-z0-9-]+\/tokens\.json$/).nullable(),
}).strict().refine((e) => (e.origin === 'extracted') === e.id.startsWith('ext-'), { message: 'extracted styles use an ext-NN id', path: ['id'] });

const entries = z.array(PublicEntry).parse(JSON.parse(readFileSync(join(lib, 'styles.json'), 'utf8')));

type Source = { id: string; serviceName: string; homepage: string; allowedUrls: string[] };
const sourcesPath = process.env.EQUIPE_DESIGN_SOURCES;
const sources = sourcesPath
  ? (JSON.parse(readFileSync(sourcesPath, 'utf8')) as { styles: Source[]; forbiddenWords: string[] })
  : undefined;

/** What the publisher sends: the public entry minus id and tokens, plus the private source by id. */
function joined(source: (e: z.infer<typeof PublicEntry>) => Source | undefined) {
  return entries.map(({ id: _id, tokens: _tokens, ...e }) => {
    const s = source({ id: _id, tokens: _tokens, ...e });
    return s ? { ...e, source: { serviceName: s.serviceName, homepage: s.homepage, allowedUrls: s.allowedUrls } } : e;
  });
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('library/styles.json', () => {
  it('has unique ids and slugs, 30 originals', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(new Set(entries.map((e) => e.slug)).size).toBe(entries.length);
    expect(entries.filter((e) => e.origin === 'original')).toHaveLength(30);
  });

  it('passes the L0 LibraryFile type once joined with a source', () => {
    const placeholder = { id: '', serviceName: 'placeholder', homepage: 'https://example.com/', allowedUrls: ['https://example.com/'] };
    expect(() => LibraryFile.parse(joined((e) => (e.origin === 'extracted' ? placeholder : undefined)))).not.toThrow();
  });

  it('points every original at its tokens and leaves extracted ones empty until extracted', () => {
    for (const e of entries) {
      if (e.origin === 'original') expect(existsSync(join(lib, e.tokens ?? '')), e.slug).toBe(true);
      else expect([e.tokens, e.description, e.category, e.tags.length]).toEqual([null, '', 'pending', 0]);
    }
  });

  it('carries no source field, URL or host anywhere under library/', () => {
    for (const f of files(lib).filter((p) => p.endsWith('.json'))) {
      const text = readFileSync(f, 'utf8');
      expect(text, relative(root, f)).not.toMatch(/"(source|serviceName|homepage|allowedUrls)"/);
      expect(text, relative(root, f)).not.toMatch(/https?:\/\//);
    }
  });
});

describe.skipIf(!sources)('with the private sources (EQUIPE_DESIGN_SOURCES)', () => {
  it('has a source for every extracted style and nothing else', () => {
    const ids = entries.filter((e) => e.origin === 'extracted').map((e) => e.id).sort();
    expect(sources!.styles.map((s) => s.id).sort()).toEqual(ids);
  });

  it('passes the L0 LibraryFile type with the real sources', () => {
    const byId = new Map(sources!.styles.map((s) => [s.id, s]));
    expect(() => LibraryFile.parse(joined((e) => byId.get(e.id)))).not.toThrow();
  });

  it('names no service, domain or design system anywhere under library/', () => {
    const words = sources!.forbiddenWords;
    expect(words.length).toBeGreaterThan(30);
    for (const f of files(lib)) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const w of words) {
        const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'u');
        expect(re.test(text), `${relative(root, f)} mentions a source`).toBe(false);
      }
    }
  });
});

describe('the 66-item registry', () => {
  it('shares no name with a style, so both can live under one URL namespace', () => {
    const official = JSON.parse(readFileSync(join(root, 'packages/registry/official-components.json'), 'utf8')) as { count: number; items: { name: string }[] };
    expect(official.items).toHaveLength(official.count);
    const names = new Set(official.items.map((i) => i.name));
    for (const e of entries) expect(names.has(e.slug), e.slug).toBe(false);
  });
});
