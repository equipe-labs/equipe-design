// Users only ever see our style names: no public response may say where an extracted style came from.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { PUBLIC_RESPONSES, SOURCE_FIELD_NAMES, StyleCard, StyleDetail } from '../src/index.ts';
import { INPUTS, buildFixtures } from './build-fixtures.ts';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = new Set(SOURCE_FIELD_NAMES.map((s) => s.toLowerCase()));

/** Every property name in a JSON Schema, following $refs inside `root`. */
function propertyNames(schema: unknown, root: unknown, seen = new Set<unknown>()): string[] {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return [];
  seen.add(schema);
  const out: string[] = [];
  const s = schema as Record<string, unknown>;
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    const target = s.$ref.slice(2).split('/').reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], root);
    out.push(...propertyNames(target, root, seen));
  }
  if (s.properties && typeof s.properties === 'object') out.push(...Object.keys(s.properties));
  for (const v of Object.values(s)) {
    if (Array.isArray(v)) for (const x of v) out.push(...propertyNames(x, root, seen));
    else if (v && typeof v === 'object') out.push(...propertyNames(v, root, seen));
  }
  return out;
}

describe('public responses carry no source', () => {
  it('zod public types have no source-name or URL field', () => {
    for (const [route, type] of Object.entries(PUBLIC_RESPONSES)) {
      const js = z.toJSONSchema(type, { io: 'output', unrepresentable: 'any' });
      const names = propertyNames(js, js);
      expect(names.length, route).toBeGreaterThan(0);
      expect(names.filter((n) => forbidden.has(n.toLowerCase())), route).toEqual([]);
    }
  });

  it('OpenAPI public paths have no source-name or URL field', () => {
    const doc = parse(readFileSync(join(pkg, 'openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    let checked = 0;
    for (const [path, item] of Object.entries(doc.paths)) {
      if (path.startsWith('/admin/')) continue;
      for (const [method, op] of Object.entries(item)) {
        if (method === 'parameters') continue;
        const responses = (op as { responses: Record<string, unknown> }).responses;
        const names = propertyNames(responses, doc);
        expect(names.filter((n) => forbidden.has(n.toLowerCase())), `${method} ${path}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(7);
  });

  it('the source shape only appears under admin paths', () => {
    const doc = parse(readFileSync(join(pkg, 'openapi.yaml'), 'utf8')) as { paths: Record<string, unknown> };
    for (const [path, item] of Object.entries(doc.paths)) {
      if (!path.startsWith('/admin/')) expect(JSON.stringify(item), path).not.toMatch(/StyleSource|StyleUpsert|ReleaseUpload/);
    }
  });

  it('a public response with a source field is refused', () => {
    const fx = buildFixtures();
    const detail = fx['public/styles/tessel.json'] as { style: object };
    expect(StyleDetail.safeParse({ ...detail, style: { ...detail.style, homepage: 'https://equipe.im/' } }).success).toBe(false);
    expect(StyleDetail.safeParse({ ...detail, source: { url: 'https://equipe.im/' } }).success).toBe(false);
    const card = (fx['public/styles.json'] as { styles: object[] }).styles[0]!;
    expect(StyleCard.safeParse({ ...card, serviceName: 'Toss' }).success).toBe(false);
  });

  it("public fixtures don't mention the extracted style's service, homepage, URLs or engine run id", () => {
    const fx = buildFixtures();
    const ex = INPUTS.find((i) => i.entry.origin === 'extracted')!;
    const secrets = [
      ex.entry.source!.serviceName,
      ex.entry.source!.homepage,
      ...ex.entry.source!.allowedUrls,
      new URL(ex.entry.source!.homepage).host,
      (ex.json as { run: { id: string } }).run.id,
    ];
    for (const [p, v] of Object.entries(fx)) {
      if (!p.startsWith('public/')) continue;
      const text = JSON.stringify(v).toLowerCase();
      for (const s of secrets) expect(text.includes(s.toLowerCase()), `${p} contains ${s}`).toBe(false);
      expect(text, p).not.toMatch(/https?:\/\//);
    }
  });
});
