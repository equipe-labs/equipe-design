-- equipe-design library: first schema (T-299, from the T-288 draft).
-- Contract: docs/library-api.md. Postgres 16 (Neon), tested on PGlite.
--
-- The library holds two kinds of style:
--   extracted — values measured from a real service's public pages (extraction_runs + style_sources);
--   original  — a style we made ourselves (T-291): tokens only, no extraction run, no source.
-- Users only ever see the style name we gave it. The source service's name, homepage and URLs
-- live in style_sources and in extraction_runs.extract / report_md, which the public role
-- (api_ro) cannot read: grants at the end of this file are by column.
-- No table has a column about a person: no accounts, IPs or e-mails.

create extension if not exists pg_trgm;

-- 1) Styles: what the library lists. slug comes from our style name ('plume'), never the service.
create table styles (
  id              smallint generated always as identity primary key,
  slug            text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'),
  name            text not null check (length(name) between 1 and 40),   -- our style name 'Plume'
  origin          text not null check (origin in ('extracted', 'original')),
  description     text not null default '' check (length(description) <= 280),
  category        text not null check (category ~ '^[a-z0-9-]{2,30}$'),
  tags            text[] not null default '{}',
  status          text not null default 'active'
                  check (status in ('active', 'paused', 'withdrawn')),
                  -- paused: not re-extracted for now, last release stays public
                  -- withdrawn: taken down (source's request) — hidden, its releases answer 410
  current_release uuid,                                     -- FK added below
  -- card and search summary, copied from the current release on publish
  brand_hex       text check (brand_hex ~ '^#[0-9a-f]{6}$'),
  brand_hue       real check (brand_hue >= 0 and brand_hue < 360),        -- OKLCH hue
  has_dark        boolean,
  fonts           text[] not null default '{}',              -- family names only, no files
  preview         jsonb,                                     -- {light:{role:hex x8}, dark:{...}|null}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index styles_name_trgm on styles using gin (name gin_trgm_ops);
create index styles_tags on styles using gin (tags);
create index styles_category on styles (category) where status <> 'withdrawn';

-- 2) Where an extracted style came from. Internal: publisher only, never in a public response.
--    One row per extracted style; originals have none.
create table style_sources (
  style_id      smallint primary key references styles(id) on delete cascade,
  service_name  text not null,                               -- 'Toss' (internal mapping, T-291 names.md table B)
  homepage      text not null check (homepage ~ '^https://'),
  allowed_urls  text[] not null check (cardinality(allowed_urls) between 1 and 5),
                                                             -- same origin, the engine's max of 5
  notes         text                                        -- robots / terms check record
);

-- 3) Extraction runs (extracted styles only). Kept forever for history and diffs.
--    id is ours: the engine's run.id holds the host name, so it stays in engine_run_id (internal).
create table extraction_runs (
  id              uuid primary key,
  style_id        smallint not null references styles(id),
  engine_run_id   text not null,
  started_at      timestamptz not null,
  finished_at     timestamptz not null,
  engine_version  text not null,                             -- 'equipe-design 0.3.1'
  schema_version  text not null,                             -- '0.1'
  ran_on          text not null,                             -- 'mac-mini'
  outcome         text not null check (outcome in ('ok', 'partial', 'stopped')),
  stop_kind       text,                                      -- 'robots-disallowed' | 'bot-challenge' | ...
  extract         jsonb not null,                            -- extract.json in full (internal: has source URLs)
  report_md       text not null,                             -- internal: names pages
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  unique (style_id, content_sha256),
  check (outcome = 'stopped' or stop_kind is null)
);
create index runs_by_style on extraction_runs (style_id, finished_at desc);

-- 4) Releases: one published-or-pending set of tokens for a style, whatever its origin.
--    Everything public about a style hangs off a release; an extracted release points at its run,
--    an original one has none.
create table releases (
  id              uuid primary key,
  style_id        smallint not null references styles(id),
  version         integer not null check (version >= 1),     -- 1, 2, … per style
  origin          text not null check (origin in ('extracted', 'original')),
  run_id          uuid unique references extraction_runs(id),
  detail          jsonb not null,                            -- public detail body (StyleDetail.release), checked on upload
  diff_from_prev  jsonb,                                     -- change summary against the previous published release
  review          text not null default 'pending'
                  check (review in ('pending', 'auto-approved', 'approved', 'rejected')),
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  published_at    timestamptz,                               -- null = not public yet
  created_at      timestamptz not null default now(),
  unique (style_id, version),
  unique (style_id, content_sha256),
  check ((origin = 'extracted') = (run_id is not null)),
  check (published_at is null or review in ('auto-approved', 'approved'))
);
create index releases_by_style on releases (style_id, version desc);
alter table styles
  add constraint styles_current_release_fk foreign key (current_release) references releases(id);

-- 5) Token files per release and format, made on the Mac. The server only serves them.
create table token_artifacts (
  release_id  uuid not null references releases(id) on delete cascade,
  format      text not null check (format in
              ('dtcg', 'dtcg-legacy', 'css', 'tailwind', 'shadcn', 'figma', 'swift', 'kotlin')),
  files       jsonb not null,                                -- {"tokens.css": "..."}
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),  -- ETag
  bytes       integer not null check (bytes > 0),
  primary key (release_id, format)
);

-- 6) Remix results: not used in the MVP (computed per request, CDN-cached). Turned on with share links.
--    Keyed by a hash of the input; who made it is not stored.
create table remixes (
  id            text primary key check (id ~ '^[a-z2-7]{12}$'),   -- base32, /design/library/r/<id>
  params_hash   text not null unique,
  params        jsonb not null,                              -- {sources:[{release, roles?}], brand:{color}, prefix, variants, fontAlt}
  release_ids   uuid[] not null,
  result        jsonb not null,
  remix_version text not null,
  created_at    timestamptz not null default now(),
  last_read_at  timestamptz not null default now()           -- rows unread for 90 days are deleted
);

-- 7) Roles. Neon creates the login roles and their passwords (Vercel env only); here we only grant.
--    api_ro reads public columns only; publisher writes. Skipped where the roles don't exist yet.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'api_ro') then
    grant select (id, slug, name, origin, description, category, tags, status, current_release,
                  brand_hex, brand_hue, has_dark, fonts, preview, created_at, updated_at) on styles to api_ro;
    grant select (id, style_id, version, origin, detail, diff_from_prev, review, published_at, created_at)
      on releases to api_ro;
    grant select on token_artifacts to api_ro;
    grant select on remixes to api_ro;
    -- no grant at all on style_sources or extraction_runs
  end if;
  if exists (select 1 from pg_roles where rolname = 'publisher') then
    grant select, insert, update on styles, style_sources, extraction_runs, releases, token_artifacts, remixes
      to publisher;
    grant delete on style_sources, token_artifacts, remixes to publisher;
    grant usage on all sequences in schema public to publisher;
  end if;
end
$$;
