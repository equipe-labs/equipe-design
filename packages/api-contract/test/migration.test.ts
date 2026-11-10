// apps/library-api/migrations/*.sql on PGlite (embedded Postgres), with the fixture seed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, '..', '..', '..', 'apps', 'library-api', 'migrations');
const migration = ['0001_init.sql', '0002_localized_text.sql'].map((f) => readFileSync(join(migrations, f), 'utf8')).join('\n');
const seed = readFileSync(join(here, '..', 'fixtures', 'seed.sql'), 'utf8');

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create({ extensions: { pg_trgm } });
  // Neon makes these login roles; the migration only grants.
  await db.exec('create role api_ro; create role publisher;');
  await db.exec(migration);
  await db.exec(seed);
}, 60_000);
afterAll(async () => db?.close());

async function as<T>(role: string, sql: string): Promise<T[]> {
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql)).rows;
  } finally {
    await db.exec('reset role');
  }
}

describe('migrations (0001_init + 0002_localized_text)', () => {
  it('applies and takes the fixtures', async () => {
    const rows = (await db.query<{ slug: string; origin: string; runs: number; formats: number }>(
      `select s.slug, s.origin, count(distinct x.id)::int as runs, count(t.format)::int as formats
         from styles s join releases r on r.id = s.current_release
         left join extraction_runs x on x.id = r.run_id
         left join token_artifacts t on t.release_id = r.id
        group by s.slug, s.origin order by s.slug`,
    )).rows;
    expect(rows).toEqual([
      { slug: 'hush', origin: 'original', runs: 0, formats: 5 },
      { slug: 'klaxon', origin: 'original', runs: 0, formats: 5 },
      { slug: 'tessel', origin: 'extracted', runs: 1, formats: 5 },
    ]);
  });

  it('searches names with pg_trgm', async () => {
    const rows = (await db.query<{ slug: string }>(`select slug from styles where name % 'Hus' or name ilike '%hus%'`)).rows;
    expect(rows.map((r) => r.slug)).toEqual(['hush']);
  });

  it('api_ro reads the public columns', async () => {
    const rows = await as<{ slug: string; brand_hex: string }>('api_ro', `select slug, brand_hex from styles order by slug`);
    expect(rows.map((r) => r.slug)).toEqual(['hush', 'klaxon', 'tessel']);
    const tokens = await as<{ n: number }>('api_ro', `select count(*)::int as n from token_artifacts`);
    expect(tokens[0]!.n).toBe(15);
  });

  it("api_ro can't read where a style came from", async () => {
    await expect(as('api_ro', 'select service_name from style_sources')).rejects.toThrow(/permission denied/);
    await expect(as('api_ro', 'select extract from extraction_runs')).rejects.toThrow(/permission denied/);
    await expect(as('api_ro', 'select run_id from releases')).rejects.toThrow(/permission denied/);
    await expect(as('api_ro', 'select * from styles')).resolves.toBeDefined();
  });

  it("api_ro can't write", async () => {
    await expect(as('api_ro', `insert into styles (slug, name, origin, category) values ('x1', 'X', 'original', 'minimal')`)).rejects.toThrow(/permission denied/);
    await expect(as('api_ro', `update styles set status = 'withdrawn'`)).rejects.toThrow(/permission denied/);
  });

  it('publisher writes', async () => {
    await as('publisher', `insert into styles (slug, name, origin, category) values ('gilt', 'Gilt', 'original', 'luxury')`);
    await as('publisher', `delete from style_sources where style_id = -1`);
    const n = (await db.query<{ n: number }>(`select count(*)::int as n from styles`)).rows[0]!.n;
    expect(n).toBe(4);
  });

  it('keeps an original release without a run and an extracted one with', async () => {
    await expect(db.exec(
      `insert into releases (id, style_id, version, origin, detail, content_sha256) values
        ('00000000-0000-4000-8000-000000000001', 3, 2, 'extracted', '{}', repeat('a', 64))`,
    )).rejects.toThrow(/check/);
    await expect(db.exec(
      `insert into releases (id, style_id, version, origin, run_id, detail, content_sha256) values
        ('00000000-0000-4000-8000-000000000002', 1, 2, 'original', '0b7d9e52-3c1f-4e8a-b6d2-7a9c1e4f5b03', '{}', repeat('b', 64))`,
    )).rejects.toThrow(/check|unique/);
  });

  it('refuses a published release that was not approved', async () => {
    await expect(db.exec(
      `insert into releases (id, style_id, version, origin, detail, content_sha256, published_at) values
        ('00000000-0000-4000-8000-000000000003', 1, 3, 'original', '{}', repeat('c', 64), now())`,
    )).rejects.toThrow(/check/);
  });

  it('keeps descriptions in the site languages, never English or an unknown locale', async () => {
    const rows = await as<{ slug: string; ko: string }>('api_ro', `select slug, description_i18n->>'ko' as ko from styles where slug = 'hush'`);
    expect(rows[0]!.ko).toMatch(/회색/);
    await expect(db.exec(`update styles set description_i18n = '{"en": "x"}' where slug = 'hush'`)).rejects.toThrow(/check/);
    await expect(db.exec(`update styles set description_i18n = '{"pt": "x"}' where slug = 'hush'`)).rejects.toThrow(/check/);
    await expect(db.exec(`update styles set description_i18n = '"x"' where slug = 'hush'`)).rejects.toThrow(/check/);
  });

  it('refuses a slug that is not lowercase', async () => {
    await expect(db.exec(`insert into styles (slug, name, origin, category) values ('Toss', 'Toss', 'original', 'fintech')`)).rejects.toThrow(/check/);
  });
});
