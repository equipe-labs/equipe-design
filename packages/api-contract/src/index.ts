// Design library API v1: request and response types (zod). The prose contract is docs/library-api.md,
// the wire contract is ../openapi.yaml; the three must agree (test/contract.test.ts checks).
//
// Public responses are .strict(): a field that isn't listed here is an error, so the source
// service's name, homepage or URLs can't slip into one. Those live only in admin types.
import { z } from 'zod';

export const API_VERSION = '1';
export const DEFAULT_BASE_URL = 'https://equipe.im/api/design/v1';

// ---------- shared ----------

export const ROLES = [
  'background', 'surface', 'raised', 'text', 'muted-text', 'primary', 'on-primary', 'secondary',
  'accent', 'border', 'border-strong', 'ring', 'destructive', 'success', 'warning',
] as const;
export const PREVIEW_ROLES = ['background', 'surface', 'text', 'muted-text', 'primary', 'on-primary', 'accent', 'border'] as const;
export const TYPE_ROLES = ['display', 'h1', 'h2', 'h3', 'body', 'small', 'mono'] as const;
/** Formats the public API serves. Swift and Kotlin are made on the Mac but only handed out by the CLI. */
export const PUBLIC_FORMATS = ['dtcg', 'dtcg-legacy', 'css', 'tailwind', 'shadcn', 'figma'] as const;
export const UPLOAD_FORMATS = [...PUBLIC_FORMATS, 'swift', 'kotlin'] as const;
export const REMIX_FORMATS = ['dtcg', 'css', 'tailwind', 'shadcn'] as const;
export const ORIGINS = ['extracted', 'original'] as const;
/** The equipe.im site languages. `en` is the base: it lives in the plain field, the others in its `…I18n` map. */
export const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'de', 'fr', 'es', 'pt-BR'] as const;
export const TRANSLATED_LOCALES = LOCALES.filter((l) => l !== 'en') as Exclude<(typeof LOCALES)[number], 'en'>[];
export type Locale = (typeof LOCALES)[number];

export const Hex = z.string().regex(/^#[0-9a-f]{6}$/, 'lowercase #rrggbb');
export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/, 'a-z, 0-9 and -, 1-40 long');
export const Uuid = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const Category = z.string().regex(/^[a-z0-9-]{2,30}$/);
export const Tag = z.string().regex(/^[a-z0-9-]{1,30}$/);
export const Origin = z.enum(ORIGINS);
export const Role = z.enum(ROLES);
export const PublicFormat = z.enum(PUBLIC_FORMATS);
export const UploadFormat = z.enum(UPLOAD_FORMATS);
export const RemixFormat = z.enum(REMIX_FORMATS);
/** Style names are ours (T-291 names.md): a word or two, letters first. */
export const StyleName = z.string().regex(/^[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?$/).max(40);

/** The slug is always made from our style name — never from the source service. */
export function slugFromName(name: string): string {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export const ERROR_CODES = [
  'bad_request', 'unauthorized', 'not_found', 'gone', 'conflict', 'payload_too_large',
  'unprocessable', 'rate_limited', 'internal',
] as const;
export const ErrorBody = z.object({
  error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }).strict(),
}).strict();

const ColorMap = z.object(Object.fromEntries(ROLES.map((r) => [r, Hex])) as Record<(typeof ROLES)[number], typeof Hex>).strict();
const PreviewMap = z.object(Object.fromEntries(PREVIEW_ROLES.map((r) => [r, Hex])) as Record<(typeof PREVIEW_ROLES)[number], typeof Hex>).strict();
const TypeStyle = z.object({
  family: z.enum(['sans', 'mono', 'display']),
  size: z.number().positive(),
  weight: z.number().int().min(1).max(1000),
  lineHeight: z.number().positive(),
  letterSpacing: z.number(),
}).strict();
/** Translations of an English field: locale -> text. A missing locale falls back to the English field. */
export const Translations = (max: number) =>
  z.partialRecord(z.enum(TRANSLATED_LOCALES), z.string().min(1).max(max));
const FileMap = z.record(z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/), z.string());

// ---------- public (no sign-in) ----------

export const StyleCard = z.object({
  slug: Slug,
  name: StyleName,
  origin: Origin,
  category: Category,
  tags: z.array(Tag),
  brand: z.object({ hex: Hex.nullable(), hue: z.number().min(0).lt(360).nullable() }).strict(),
  hasDark: z.boolean(),
  fonts: z.array(z.string().max(80)).max(4),
  preview: z.object({ light: PreviewMap, dark: PreviewMap.nullable() }).strict(),
  releaseId: Uuid,
  version: z.number().int().min(1),
  updatedAt: Timestamp,
}).strict();
export type StyleCard = z.infer<typeof StyleCard>;

export const StyleList = z.object({
  styles: z.array(StyleCard),
  total: z.number().int().min(0),
}).strict();
export type StyleList = z.infer<typeof StyleList>;

export const ComponentState = z.enum(['default', 'hover', 'focus-visible', 'active', 'disabled']);
export const ComponentVariant = z.object({
  name: z.string().max(40),
  background: Hex.nullable(),
  text: Hex.nullable(),
  border: Hex.nullable(),
  radiusPx: z.number().min(0).nullable(),
  /** true = seen on the page, false = not seen (a limit says why). */
  states: z.partialRecord(ComponentState, z.boolean()),
}).strict();
export const Component = z.object({
  kind: z.string().regex(/^[a-z-]{2,30}$/),
  variants: z.array(ComponentVariant),
}).strict();

/** A limit in plain words. No URLs: the publisher rejects one that names the source.
 *  `text` is English; `textI18n` holds the other site languages (a missing one falls back to `text`). */
export const Limit = z.object({ scope: z.string().max(120), text: z.string().max(400), textI18n: Translations(400).default({}) }).strict();

/** What a release shows on the detail page. Built on the Mac, checked again by the server on upload. */
export const ReleaseBody = z.object({
  roles: z.object({ light: ColorMap, dark: ColorMap.nullable() }).strict(),
  scales: z.object({
    space: z.array(z.number().min(0)).max(16),
    radius: z.array(z.number().min(0)).max(12),
  }).strict(),
  typography: z.object({
    fonts: z.object({ sans: z.array(z.string()), mono: z.array(z.string()), display: z.array(z.string()).nullable() }).strict(),
    roles: z.object(Object.fromEntries(TYPE_ROLES.map((r) => [r, TypeStyle])) as Record<(typeof TYPE_ROLES)[number], typeof TypeStyle>).strict(),
  }).strict(),
  components: z.array(Component),
  limits: z.array(Limit),
}).strict();
export type ReleaseBody = z.infer<typeof ReleaseBody>;

export const ReleaseDetail = ReleaseBody.extend({
  id: Uuid,
  version: z.number().int().min(1),
  origin: Origin,
  publishedAt: Timestamp,
  formats: z.array(PublicFormat),
  /** How it was measured; null for an original style (nothing was measured). */
  measured: z.object({ engineVersion: z.string(), schemaVersion: z.string(), finishedAt: Timestamp }).strict().nullable(),
}).strict();
export type ReleaseDetail = z.infer<typeof ReleaseDetail>;

export const ReleaseSummary = z.object({
  id: Uuid,
  version: z.number().int().min(1),
  publishedAt: Timestamp,
  changes: z.string().max(400).nullable(),
}).strict();

export const StyleDetail = z.object({
  /** `description` is English; `descriptionI18n` holds the other site languages (a missing one falls back to it). */
  style: StyleCard.extend({ description: z.string().max(280), descriptionI18n: Translations(280) }).strict(),
  release: ReleaseDetail,
  releases: z.array(ReleaseSummary),
  notice: z.string(),
}).strict();
export type StyleDetail = z.infer<typeof StyleDetail>;

export const ReleaseList = z.object({ releases: z.array(ReleaseSummary) }).strict();

export const TokenFiles = z.object({
  releaseId: Uuid,
  format: PublicFormat,
  files: FileMap,
}).strict();
export type TokenFiles = z.infer<typeof TokenFiles>;

export const Meta = z.object({
  apiVersion: z.literal(API_VERSION),
  schemaVersion: z.string(),
  engineVersion: z.string().nullable(),
  remixVersion: z.string(),
  styles: z.object({ total: z.number().int().min(0), extracted: z.number().int().min(0), original: z.number().int().min(0) }).strict(),
  lastPublishedAt: Timestamp.nullable(),
}).strict();
export type Meta = z.infer<typeof Meta>;

const RemixSource = z.union([
  z.object({ style: Slug, roles: z.array(Role).min(1).optional() }).strict(),
  z.object({ release: Uuid, roles: z.array(Role).min(1).optional() }).strict(),
]);
/** POST /remix. Strict: keepBrand / ownSite are CLI-only and rejected here. Body ≤ 8 KB (server). */
export const RemixRequest = z.object({
  sources: z.array(RemixSource).min(1).max(3),
  brand: z.object({ color: Hex }).strict(),
  prefix: z.string().regex(/^[a-z0-9-]{1,32}$/),
  variants: z.number().int().min(1).max(3).default(2),
  fontAlt: z.boolean().default(true),
  formats: z.array(RemixFormat).min(1).max(REMIX_FORMATS.length).default(['css', 'dtcg']),
}).strict();
export type RemixRequest = z.input<typeof RemixRequest>;
export const REMIX_MAX_BODY_BYTES = 8 * 1024;

export const RemixResponse = z.object({
  remixVersion: z.string(),
  sources: z.array(z.object({ style: Slug, releaseId: Uuid }).strict()),
  variants: z.array(z.object({
    id: z.string().regex(/^v[1-3]$/),
    strategy: z.enum(['accent', 'tinted', 'filled']),
    files: z.partialRecord(RemixFormat, FileMap),
    contrastFails: z.number().int().min(0),
    fonts: z.array(z.object({ family: z.string(), role: z.enum(['sans', 'mono', 'display']) }).strict()),
  }).strict()).min(1).max(3),
  notice: z.string(),
}).strict();
export type RemixResponse = z.infer<typeof RemixResponse>;

/** Every public response type, by the path that returns it. */
export const PUBLIC_RESPONSES = {
  'GET /styles': StyleList,
  'GET /styles/{slug}': StyleDetail,
  'GET /styles/{slug}/releases': ReleaseList,
  'GET /releases/{releaseId}/tokens/{format}': TokenFiles,
  'GET /meta': Meta,
  'POST /remix': RemixResponse,
} as const;

/** Field names that would carry where a style came from. None may appear in a public type. */
export const SOURCE_FIELD_NAMES = [
  'source', 'sources_urls', 'service', 'serviceName', 'service_name', 'homepage', 'url', 'urls',
  'allowedUrls', 'allowed_urls', 'finalUrl', 'host', 'domain', 'origin_url', 'engineRunId', 'extract', 'reportMd',
];

// ---------- publishing (our Mac only, Bearer EQUIPE_DESIGN_PUBLISH_TOKEN) ----------

const httpsUrl = z.url({ protocol: /^https$/ });

/** Internal: where an extracted style comes from. Never returned by a public path. */
export const StyleSource = z.object({
  serviceName: z.string().min(1).max(80),
  homepage: httpsUrl,
  allowedUrls: z.array(httpsUrl).min(1).max(5),
}).strict().refine(
  (s) => s.allowedUrls.every((u) => new URL(u).origin === new URL(s.homepage).origin),
  { message: 'allowedUrls must share the homepage origin', path: ['allowedUrls'] },
);

/** PUT /admin/styles/{slug} — one entry of library/styles.json, minus the slug (it's in the path). */
export const StyleUpsert = z.object({
  name: StyleName,
  origin: Origin,
  description: z.string().max(280).default(''),
  descriptionI18n: Translations(280).default({}),
  category: Category,
  tags: z.array(Tag).max(12).default([]),
  source: StyleSource.optional(),
}).strict().refine((s) => (s.origin === 'extracted') === (s.source !== undefined), {
  message: 'an extracted style needs source; an original style must not have one',
  path: ['source'],
});
export type StyleUpsert = z.input<typeof StyleUpsert>;

/** One entry of library/styles.json (L6): the slug must be slugFromName(name). */
export const LibraryEntry = z.intersection(z.object({ slug: Slug }), StyleUpsert)
  .refine((e) => e.slug === slugFromName(e.name), { message: 'slug must come from the style name', path: ['slug'] });
export const LibraryFile = z.array(LibraryEntry);

const UploadTokens = z.partialRecord(UploadFormat, FileMap).refine((t) => t.dtcg !== undefined, { message: 'dtcg is required' });

/** POST /admin/releases. The server re-checks `extract` with @equipe-design/schema and source URLs against allowedUrls. */
export const ReleaseUpload = z.discriminatedUnion('origin', [
  z.object({
    origin: z.literal('extracted'),
    style: Slug,
    runId: Uuid,
    ranOn: z.string().regex(/^[a-z0-9-]{2,40}$/),
    extract: z.record(z.string(), z.unknown()),
    reportMd: z.string(),
    body: ReleaseBody,
    tokens: UploadTokens,
  }).strict(),
  z.object({
    origin: z.literal('original'),
    style: Slug,
    body: ReleaseBody,
    tokens: UploadTokens,
  }).strict(),
]);
export type ReleaseUpload = z.infer<typeof ReleaseUpload>;

export const ReleaseUploadResult = z.object({
  releaseId: Uuid,
  version: z.number().int().min(1),
  review: z.enum(['pending', 'auto-approved']),
  published: z.boolean(),
  changes: z.string().nullable(),
}).strict();

export const PublishResult = z.object({ releaseId: Uuid, style: Slug, publishedAt: Timestamp }).strict();
export const WithdrawResult = z.object({ style: Slug, status: z.literal('withdrawn') }).strict();

/** The text the site shows for `locale`: the translation if there is one, else the English field. */
export function localized(en: string, i18n: Partial<Record<string, string>> | undefined, locale: string): string {
  return (locale !== 'en' && i18n?.[locale]) || en;
}

/** The `notice` on every style detail, by origin. The site translates it; the API sends English. */
export const NOTICE = {
  extracted:
    'Values measured from public pages: colours, sizes and font names only — no logos, font files, images or text. ' +
    'Not affiliated with or endorsed by any company. Remix it into your own brand before you use it.',
  original: 'An original style made for the equipe design library. Fonts are open-licensed (OFL).',
} as const;
