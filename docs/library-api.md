# Design library API v1

The contract for the equipe design library: what it stores, what it serves, and to whom.
Change this document first, then `packages/api-contract/openapi.yaml` and the zod types in
`packages/api-contract/src/index.ts`; the tests in `packages/api-contract/test/` keep the three in step.

- Base URL: `https://equipe.im/api/design/v1` (equipe.im rewrites `/api/design/*` to the library's Vercel project).
- Public paths need no sign-in. Admin paths are for our publishing Mac only.
- Every error is `{"error": {"code": "...", "message": "..."}}`.

## What the library holds

A **style** is one design system in the library, always shown under a name we gave it (T-291 `names.md`).
There are two kinds (`origin`):

| origin | What it is | Where its values come from |
|---|---|---|
| `extracted` | Values measured from a real service's public pages | An extraction run on our Mac, limited to that style's `allowedUrls` |
| `original` | A style we made ourselves (T-291, 30 of them) | Its `tokens.json`; no extraction run, no source |

**Users never see where an extracted style came from.** The source service's name, homepage, allowed URLs,
the engine's run id (it holds the host name), `extract.json` and the report stay internal:

- in the database they sit in `style_sources` and in `extraction_runs.extract` / `report_md` / `engine_run_id`,
  which the public role `api_ro` has no grant on (grants are by column);
- in the API they only appear in admin request bodies (`StyleSource`, `ReleaseUpload`);
- the slug is made from our style name (`slugFromName`), never from the service.

A **release** is one set of tokens for a style. Everything public about a style hangs off its current release,
whatever its origin: an extracted release points at its run, an original one has none.
Releases never change once made, so their files are cached for a year.

## Tables

`apps/library-api/migrations/0001_init.sql` (Postgres 16 / Neon; tested on PGlite).

| Table | One row is | Public (`api_ro`) |
|---|---|---|
| `styles` | a style: slug, our name, origin, category, tags, status, current release, card summary | listed columns |
| `style_sources` | where an extracted style comes from: service name, homepage, `allowed_urls` (1–5, same origin) | **no** |
| `extraction_runs` | one extraction (extracted styles only), with `extract.json` in full | **no** |
| `releases` | a set of tokens for a style, its public `detail`, review state | listed columns (not `run_id`, `content_sha256`) |
| `token_artifacts` | a release × format: file name → text, sha256 | yes |
| `remixes` | a stored remix — unused until share links | yes |

Nothing about a person is stored: no accounts, IPs or e-mails.

`status`: `active`; `paused` (not re-extracted, last release stays public); `withdrawn` (taken down, e.g. at the
source's request — hidden from lists, detail and token paths answer 410).
`review`: `pending` → `approved` / `rejected`, or `auto-approved` for a small change. Only an approved release can
have `published_at`.

## Public paths

| Method · path | Returns | Cache-Control | Errors |
|---|---|---|---|
| `GET /styles?q&category&tag&origin&hasDark&hue&sort=updated\|name` | `StyleList` — cards | short | 400, 429, 500 |
| `GET /styles/{slug}` | `StyleDetail` — card + description (every language), current release, release list, notice | short | 404, 410, 429, 500 |
| `GET /styles/{slug}/releases` | `ReleaseList`, newest first | short | 404, 410, 429, 500 |
| `GET /styles/{slug}/tokens/{format}` | 302 to the current release's tokens | short | 400, 404, 410, 429, 500 |
| `GET /releases/{releaseId}/tokens/{format}[?file=tokens.css]` | `TokenFiles` (`{files: {name: text}}`), or the one file as itself; `ETag` = sha256 | immutable | 400, 404, 410, 429, 500 |
| `POST /remix` | `RemixResponse` — 1–3 variants | `no-store` | 400, 404, 410, 413, 422, 429, 500 |
| `GET /meta` | `Meta` — versions, style counts by origin, last publish | short | 429, 500 |

- short = `public, max-age=60, s-maxage=300, stale-while-revalidate=86400`
- immutable = `public, max-age=31536000, immutable`
- `hue` matches brand colours within ±20° (OKLCH). `q` searches style names and tags only.
- Public formats: `dtcg` (2025.10), `dtcg-legacy` (equipe's T-145 build), `css`, `tailwind` (v4 `@theme`), `shadcn`,
  `figma`. Swift and Kotlin are made on the Mac but handed out by the CLI only.
- `notice` on every detail: for extracted styles "values only, not affiliated, remix before use"; for originals
  "an original style, OFL fonts" (`NOTICE` in the types).
- There is no public `extract.json` or report: both name the source pages. Detail pages show the release body
  (roles, scales, typography, component/state table, limits) instead.
- CORS: GET is `*`; `POST /remix` allows `https://equipe.im` only.

### Languages

The site is in eight languages: `en`, `ko`, `ja`, `zh-CN`, `de`, `fr`, `es`, `pt-BR` (`LOCALES`). The API sends
every language at once — there is no `?lang` and no `Accept-Language` handling, so one cached response serves all
pages. Two fields are text a person reads, and each comes in two parts:

| Text | English (always there) | Other languages | Max per language |
|---|---|---|---|
| Style description (`StyleDetail.style`) | `description` | `descriptionI18n` | 280 |
| A limit (`ReleaseDetail.limits[]`) | `text` | `textI18n` | 400 |

`…I18n` is `{ "ko": "…", "ja": "…", … }`: only the seven non-English locales, never `en`, never an unknown key.
A missing locale is allowed and means "not translated yet". **What the site reads for a page in locale `L`:**
`descriptionI18n[L]` if it's there, else `description`; `textI18n[L]` if it's there, else `text`. On `/en/` it is
always the English field. When the site falls back to English on a non-English page, it marks that element
`lang="en"`. `localized(en, i18n, locale)` in the types does exactly this.

- `scope`, style names, slugs, tags, categories, token and role names are identifiers, not translated.
- `notice` is English; the site has its own translations of the two `NOTICE` texts.
- `changes` on a release summary is English only for now.
- The Mac fills `…I18n` before upload: `descriptionI18n` comes with the `library/styles.json` entry
  (`PUT /admin/styles/{slug}`), `textI18n` with each limit in `ReleaseBody`. The engine writes its limits in Korean;
  the publisher puts the English in `text` and the Korean in `textI18n.ko`.
- Stored as `styles.description_i18n` (jsonb, `0002_localized_text.sql`); limits live in `releases.detail`.

### POST /remix

```json
{
  "sources": [{ "style": "hush" }, { "release": "6f1c…", "roles": ["background", "text"] }],
  "brand": { "color": "#0f766e" },
  "prefix": "acme",
  "variants": 2,
  "fontAlt": true,
  "formats": ["css", "dtcg"]
}
```

Checks (400 unless noted): 1–3 `sources`, each `style` (slug) or `release` (uuid); `brand.color` lowercase `#rrggbb`;
`prefix` `^[a-z0-9-]{1,32}$`; `variants` 1–3 (default 2); `formats` from `dtcg css tailwind shadcn`; unknown
fields are refused, so `keepBrand` is too — keeping a source's own brand colour is CLI-only (T-279 3). Body over
8 KB → 413. Unknown style → 404, withdrawn → 410, a source the engine can't remix → 422.
Computed per request with `@equipe-design/remix`, not stored; the server keeps an in-memory LRU keyed by the input hash.
The CLI and MCP remix on the user's own machine from the `dtcg` tokens instead of calling this.

## Admin paths (publishing)

`Authorization: Bearer $EQUIPE_DESIGN_PUBLISH_TOKEN`. The value lives only in Vercel (Sensitive) and the Mac's
`~/.config/equipe-design/publish.env` (0600). These paths connect as the `publisher` role; public paths as `api_ro`.

| Method · path | Body → result | Errors |
|---|---|---|
| `PUT /admin/styles/{slug}` | `StyleUpsert` (one `library/styles.json` entry without the slug) → `{style, created}` | 400, 401, 422, 500 |
| `POST /admin/releases` | `ReleaseUpload` → 201 `ReleaseUploadResult` | 400, 401, 404, 409, 413, 422, 500 |
| `POST /admin/releases/{id}/publish` | → `PublishResult`; sets `current_release`, card summary, purges CDN | 401, 404, 409, 500 |
| `POST /admin/styles/{slug}/withdraw` | → `WithdrawResult` | 401, 404, 500 |

All answer `Cache-Control: no-store`.

- `StyleUpsert`: the slug in the path must equal `slugFromName(name)` (422). An `extracted` style needs `source`
  (`serviceName`, `homepage`, `allowedUrls` 1–5, all https and the homepage's origin); an `original` must not have one.
- `ReleaseUpload` is one of:
  - `origin: "extracted"` — `runId`, `ranOn`, `extract` (checked with `@equipe-design/schema`: shape, forbidden CSS
    text, references), `reportMd`, `body`, `tokens`;
  - `origin: "original"` — `body`, `tokens` only.

  `body` is the public detail (`ReleaseBody`), built on the Mac. `tokens` is format → files and must include `dtcg`.
  The server refuses (422) an extract whose page URLs are outside the style's `allowedUrls`, and any `body` string or
  token/file name that holds the source's name or host. The same content again → 409.
  A small change against the current release is published at once (`auto-approved`); a big one waits (`pending`).

## Fixtures

`packages/api-contract/fixtures/`, made by `npm run gen:fixtures -w @equipe-design/api-contract` with the real
remix and emit code (a test fails when they're stale):

| Style | origin | From |
|---|---|---|
| `hush` | original | T-291 `systems/Hush/tokens.json` |
| `klaxon` | original | T-291 `systems/Klaxon/tokens.json` |
| `tessel` | extracted | `packages/schema/examples/equipe.im.json` ("Tessel" is a fixture-only name) |

- `public/…` — a response for every public path, as the server should answer it.
- `admin/library.json`, `admin/uploads/<slug>.json` — what the Mac sends.
- `seed.sql` — the same data as rows; apply after `0001_init.sql` and `0002_localized_text.sql` (PGlite tests).
- All three styles carry `descriptionI18n` and every limit carries `textI18n` in all seven non-English languages.
