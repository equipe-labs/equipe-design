// Builds packages/api-contract/fixtures/ from real inputs with the real remix + emit code:
//   two originals (T-291 Hush, Klaxon) and one extracted style (the schema's equipe.im example, named "Tessel").
// `npm run gen:fixtures -w @equipe-design/api-contract` writes them; test/fixtures.test.ts checks they're current.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, toDtcg, type DtcgFiles } from '@equipe-design/emit';
import { loadSource, remix, toOklch, type Source } from '@equipe-design/remix';
import type { Extraction } from '@equipe-design/schema';
import {
  NOTICE, PREVIEW_ROLES, REMIX_FORMATS, TYPE_ROLES,
  type ReleaseBody, type ReleaseUpload, type RemixRequest, type RemixResponse, type StyleCard,
  type StyleDetail, type StyleList, type StyleUpsert, type TokenFiles, type Meta,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', 'fixtures');
const require = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as unknown;

const PUBLISHED_AT = '2026-11-02T09:30:00Z';
const REMIX_VERSION = (require(join(here, '..', '..', 'remix', 'package.json')) as { version: string }).version;
const ENGINE_VERSION = 'equipe-design 0.1.0';

interface Input {
  slug: string;
  entry: StyleUpsert;
  json: unknown;
  releaseId: string;
  runId?: string;
}

const extractPath = join(here, '..', '..', 'schema', 'examples', 'equipe.im.json');
export const INPUTS: Input[] = [
  {
    slug: 'hush',
    entry: { name: 'Hush', origin: 'original', description: 'Quiet greys, one blue for links. Minimal.', category: 'minimal', tags: ['neutral', 'light-first'] },
    json: require(join(FIXTURES_DIR, 'inputs', 'hush.tokens.json')),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a01',
  },
  {
    slug: 'klaxon',
    entry: { name: 'Klaxon', origin: 'original', description: 'Black, white and a loud yellow. High contrast.', category: 'high-contrast', tags: ['bold', 'accessible'] },
    json: require(join(FIXTURES_DIR, 'inputs', 'klaxon.tokens.json')),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a02',
  },
  {
    // Fixture only: a made-up style name for the schema's example extraction.
    slug: 'tessel',
    entry: {
      name: 'Tessel', origin: 'extracted', description: 'Deep blue on white with a matching dark theme.', category: 'devtool', tags: ['blue', 'dark-mode'],
      source: { serviceName: 'equipe.im', homepage: 'https://equipe.im/', allowedUrls: ['https://equipe.im/'] },
    },
    json: require(extractPath),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a03',
    runId: '0b7d9e52-3c1f-4e8a-b6d2-7a9c1e4f5b03',
  },
];

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function body(src: Source, x: Extraction | null): ReleaseBody {
  const m = src.model;
  const roles = Object.fromEntries(TYPE_ROLES.map((r) => [r, m.type[r]!])) as ReleaseBody['typography']['roles'];
  let components: ReleaseBody['components'] = [];
  let limits: ReleaseBody['limits'];
  if (x) {
    const hex = new Map(x.observed.color.map((c) => [c.id, c.value.hex.toLowerCase()]));
    const h = (id: string | null | undefined) => (id ? (hex.get(id) ?? null) : null);
    components = (x.inferred.components ?? []).map((k) => ({
      kind: k.kind,
      variants: k.variants.map((v) => {
        const fp = v.fingerprint as { background?: string | null; color?: string | null; border?: string | null; radius?: { value: number; unit: string } | null };
        return {
          name: v.suggestedName ?? v.id,
          background: h(fp.background),
          text: h(fp.color),
          border: h(fp.border),
          radiusPx: fp.radius ? (fp.radius.unit === 'rem' ? fp.radius.value * 16 : fp.radius.value) : null,
          states: Object.fromEntries(Object.entries(v.states ?? {}).map(([s, st]) => [s, (st as { observed: boolean }).observed])),
        };
      }),
    }));
    limits = x.limits.map((l) => ({ scope: l.scope, text: [l.reason, l.effect].filter(Boolean).join(' — ') }));
  } else {
    limits = src.limits.map((l) => {
      const i = l.indexOf(': ');
      return i > 0 ? { scope: l.slice(0, i), text: l.slice(i + 2) } : { scope: '*', text: l };
    });
  }
  return {
    roles: { light: m.colors.light, dark: m.colors.dark },
    scales: { space: m.space, radius: m.radius },
    typography: { fonts: m.fonts, roles },
    components,
    limits,
  };
}

type Formats = Partial<Record<'dtcg' | 'dtcg-legacy' | 'css' | 'tailwind' | 'shadcn', Record<string, string>>>;
function tokens(dtcg: DtcgFiles, forbidden: string[]): Formats {
  const one = (f: 'dtcg' | 'css' | 'tailwind' | 'shadcn', legacy = false) => emit(dtcg, [f], { forbidden, legacy });
  return { dtcg: one('dtcg'), 'dtcg-legacy': one('dtcg', true), css: one('css'), tailwind: one('tailwind'), shadcn: one('shadcn') };
}

/** Builds every fixture file: path under fixtures/ -> JSON value (or text for .sql). */
export function buildFixtures(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cards: StyleCard[] = [];
  const library: unknown[] = [];
  const sources = new Map<string, Source>();
  const seed: string[] = [];
  const q = (v: unknown) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const qj = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
  const qa = (a: string[]) => `${q(`{${a.map((s) => `"${s.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`)}::text[]`;

  INPUTS.forEach((input, i) => {
    const { slug, entry } = input;
    const x = entry.origin === 'extracted' ? (input.json as Extraction) : null;
    const src = loadSource(input.json);
    sources.set(slug, src);
    const b = body(src, x);
    // The extract's own host labels; our product name ('equipe') is not a source label.
    const forbidden = src.forbiddenLabels.filter((l) => l !== 'equipe');
    const toks = tokens(toDtcg(src.model), forbidden);
    const brandHex = src.brand.light;
    const card: StyleCard = {
      slug, name: entry.name, origin: entry.origin, category: entry.category, tags: entry.tags ?? [],
      brand: { hex: brandHex, hue: brandHex ? round(toOklch(brandHex).h, 1) : null },
      hasDark: src.model.colors.dark !== null,
      fonts: [...new Set([src.model.fonts.sans[0], src.model.fonts.display?.[0], src.model.fonts.mono[0]].filter((f): f is string => !!f))],
      preview: {
        light: Object.fromEntries(PREVIEW_ROLES.map((r) => [r, src.model.colors.light[r]])) as StyleCard['preview']['light'],
        dark: src.model.colors.dark ? (Object.fromEntries(PREVIEW_ROLES.map((r) => [r, src.model.colors.dark![r]])) as StyleCard['preview']['light']) : null,
      },
      releaseId: input.releaseId,
      version: 1,
      updatedAt: PUBLISHED_AT,
    };
    cards.push(card);
    library.push({ slug, ...entry });

    const upload: ReleaseUpload = x
      ? { origin: 'extracted', style: slug, runId: input.runId!, ranOn: 'mac-mini', extract: x as unknown as Record<string, unknown>, reportMd: `# ${x.run.id}\n\nFixture report.\n`, body: b, tokens: toks }
      : { origin: 'original', style: slug, body: b, tokens: toks };
    out[`admin/uploads/${slug}.json`] = upload;

    const formats = Object.keys(toks) as TokenFiles['format'][];
    const detail: StyleDetail = {
      style: { ...card, description: entry.description ?? '' },
      release: {
        ...b, id: input.releaseId, version: 1, origin: entry.origin, publishedAt: PUBLISHED_AT, formats,
        measured: x ? { engineVersion: ENGINE_VERSION, schemaVersion: x.schemaVersion, finishedAt: x.run.startedAt } : null,
      },
      releases: [{ id: input.releaseId, version: 1, publishedAt: PUBLISHED_AT, changes: null }],
      notice: NOTICE[entry.origin],
    };
    out[`public/styles/${slug}.json`] = detail;
    out[`public/styles/${slug}/releases.json`] = { releases: detail.releases };
    for (const f of formats) {
      out[`public/releases/${input.releaseId}/tokens/${f}.json`] = { releaseId: input.releaseId, format: f, files: toks[f as keyof Formats]! } satisfies TokenFiles;
    }

    // seed.sql: the same data as rows, for PGlite tests (L1).
    const id = i + 1;
    const contentSha = sha(JSON.stringify(upload.tokens) + JSON.stringify(b));
    seed.push(
      `insert into styles (id, slug, name, origin, description, category, tags, brand_hex, brand_hue, has_dark, fonts, preview, updated_at) overriding system value values ` +
        `(${id}, ${q(slug)}, ${q(entry.name)}, ${q(entry.origin)}, ${q(entry.description ?? '')}, ${q(entry.category)}, ${qa(entry.tags ?? [])}, ${q(card.brand.hex)}, ${card.brand.hue ?? 'null'}, ${card.hasDark}, ${qa(card.fonts)}, ${qj(card.preview)}, ${q(PUBLISHED_AT)});`,
    );
    if (x && entry.source) {
      seed.push(`insert into style_sources (style_id, service_name, homepage, allowed_urls) values (${id}, ${q(entry.source.serviceName)}, ${q(entry.source.homepage)}, ${qa(entry.source.allowedUrls)});`);
      const ex = JSON.stringify(x);
      seed.push(
        `insert into extraction_runs (id, style_id, engine_run_id, started_at, finished_at, engine_version, schema_version, ran_on, outcome, extract, report_md, content_sha256) values ` +
          `(${q(input.runId)}, ${id}, ${q(x.run.id)}, ${q(x.run.startedAt)}, ${q(x.run.startedAt)}, ${q(ENGINE_VERSION)}, ${q(x.schemaVersion)}, 'mac-mini', 'ok', ${q(ex)}::jsonb, ${q((upload as { reportMd: string }).reportMd)}, ${q(sha(ex))});`,
      );
    }
    seed.push(
      `insert into releases (id, style_id, version, origin, run_id, detail, review, content_sha256, published_at) values ` +
        `(${q(input.releaseId)}, ${id}, 1, ${q(entry.origin)}, ${q(input.runId ?? null)}, ${qj(b)}, 'approved', ${q(contentSha)}, ${q(PUBLISHED_AT)});`,
    );
    for (const f of formats) {
      const files = toks[f as keyof Formats]!;
      const text = JSON.stringify(files);
      seed.push(`insert into token_artifacts (release_id, format, files, sha256, bytes) values (${q(input.releaseId)}, ${q(f)}, ${qj(files)}, ${q(sha(text))}, ${Buffer.byteLength(text)});`);
    }
    seed.push(`update styles set current_release = ${q(input.releaseId)} where id = ${id};`);
  });

  out['admin/library.json'] = library;
  const list: StyleList = { styles: [...cards].sort((a, b) => a.name.localeCompare(b.name)), total: cards.length };
  out['public/styles.json'] = list;
  out['public/meta.json'] = {
    apiVersion: '1', schemaVersion: '0.1', engineVersion: ENGINE_VERSION, remixVersion: REMIX_VERSION,
    styles: { total: cards.length, extracted: cards.filter((c) => c.origin === 'extracted').length, original: cards.filter((c) => c.origin === 'original').length },
    lastPublishedAt: PUBLISHED_AT,
  } satisfies Meta;

  // POST /remix example: Hush's shape and type with a teal brand.
  const request = { sources: [{ style: 'hush' }], brand: { color: '#0f766e' }, prefix: 'acme', variants: 2, fontAlt: true, formats: ['css', 'dtcg'] } satisfies RemixRequest;
  const results = remix([sources.get('hush')!], { color: request.brand.color, name: request.prefix }, { variants: request.variants, fontAlt: request.fontAlt });
  const response: RemixResponse = {
    remixVersion: REMIX_VERSION,
    sources: [{ style: 'hush', releaseId: INPUTS[0]!.releaseId }],
    variants: results.map((r, i) => {
      const dtcg = toDtcg(r);
      const files: RemixResponse['variants'][number]['files'] = {};
      for (const f of request.formats) if ((REMIX_FORMATS as readonly string[]).includes(f)) files[f] = emit(dtcg, [f], { prefix: request.prefix, forbidden: r.forbiddenLabels });
      const fonts = ([['sans', r.model.fonts.sans[0]], ['display', r.model.fonts.display?.[0]], ['mono', r.model.fonts.mono[0]]] as const)
        .filter((p): p is readonly ['sans' | 'display' | 'mono', string] => !!p[1])
        .map(([role, family]) => ({ family, role }));
      return { id: `v${i + 1}`, strategy: r.meta.strategy, files, contrastFails: r.contrast.fails.length, fonts };
    }),
    notice: NOTICE.original,
  };
  out['public/remix.request.json'] = request;
  out['public/remix.response.json'] = response;
  seed.push(`select setval(pg_get_serial_sequence('styles', 'id'), (select max(id) from styles));`);
  out['seed.sql'] = `-- Generated by packages/api-contract/test/build-fixtures.ts. Apply after migrations/0001_init.sql.\n${seed.join('\n')}\n`;
  return out;
}

export function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const d of ['admin', 'public']) rmSync(join(FIXTURES_DIR, d), { recursive: true, force: true });
  for (const [p, v] of Object.entries(buildFixtures())) {
    const file = join(FIXTURES_DIR, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialize(v));
  }
  process.stdout.write(`fixtures written to ${FIXTURES_DIR}\n`);
}
