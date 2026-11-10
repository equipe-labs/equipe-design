import { readdirSync, readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { validateExtraction, type Extraction } from '../src/index.ts';

const dir = new URL('../examples/', import.meta.url);
const load = (name: string): Extraction => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const issuesOf = (x: unknown) => {
  const r = validateExtraction(x);
  return r.ok ? [] : r.issues;
};

describe('examples', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('has the three reference examples', () => {
    expect(files.sort()).toEqual(['dark-only.json', 'equipe.im.json', 'robots-disallowed.json']);
  });

  it.each(files)('%s passes the schema', (f) => {
    expect(issuesOf(load(f))).toEqual([]);
  });

  it('robots-disallowed stopped before reading anything', () => {
    const x = load('robots-disallowed.json');
    expect(x.run.stoppedBy).toBe('robots-disallowed');
    expect(x.limits[0]?.kind).toBe('robots-disallowed');
    expect(x.guardrails.pagesVisited).toBe(0);
    expect(x.observed.color).toEqual([]);
  });

  it('dark-only leaves light empty instead of inventing it', () => {
    const x = load('dark-only.json');
    expect(x.limits.some((l) => l.kind === 'dark-only')).toBe(true);
    expect(x.inferred.roles?.every((r) => r.light === null)).toBe(true);
    expect(x.inferred.brand?.status).toBe('none');
  });
});

describe('forbidden content', () => {
  const base = () => load('equipe.im.json');
  const withReason = (text: string) => {
    const x = base();
    x.inferred.roles![0]!.reasons.push(text);
    return x;
  };

  it.each([
    ['a CSS rule', '.btn{background:#1d4ed8}'],
    ['a rule with spaces', ':root { --bg: #f6f5f1 }'],
    ['a lone brace', 'body {'],
    ['a declaration list', 'color: #fff; padding: 4px;'],
    ['url()', 'url(/logo.svg)'],
    ['url() with spaces', 'background: URL ( "x.png" )'],
    ['@font-face', '@font-face src'],
    ['@import', '@import "theme.css"'],
    ['a data URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a font file', '/fonts/inter.woff2'],
  ])('rejects %s', (_, text) => {
    const issues = issuesOf(withReason(text));
    expect(issues.some((i) => i.kind === 'content' && i.path === '/inferred/roles/0/reasons/2')).toBe(true);
  });

  it('rejects forbidden text anywhere, including keys and observed values', () => {
    const x = base();
    x.observed.color[0]!.mergedFrom!.push('url(#grad)');
    x.observed.typography.styles[0]!.tags!['@font-face'] = 1;
    x.observed.variables[0]!.values.light = 'url(data:font/woff2;base64,AAAA)';
    const paths = issuesOf(x).filter((i) => i.kind === 'content').map((i) => i.path);
    expect(paths).toContain('/observed/color/0/mergedFrom/1');
    expect(paths).toContain('/observed/typography/styles/0/tags/@font-face');
    expect(paths).toContain('/observed/variables/0/values/light');
  });

  it('allows the media conditions and short selectors results need', () => {
    const x = base();
    x.observed.variables[0]!.declaredIn.push({ selector: 'html.dark', condition: '@media (prefers-color-scheme: dark)' });
    x.observed.breakpoints[0]!.query = '(min-width: 640px) and (max-width: 1023px)';
    expect(issuesOf(x)).toEqual([]);
  });
});

describe('shape and references', () => {
  it('rejects a display name for the source service', () => {
    const x = { ...load('equipe.im.json'), sourceName: 'Some Service' };
    expect(issuesOf(x).some((i) => i.kind === 'schema')).toBe(true);
  });

  it('rejects stored files', () => {
    const x = load('equipe.im.json');
    (x.guardrails.stored as { fontFiles: boolean }).fontFiles = true;
    expect(issuesOf(x).some((i) => i.path === '/guardrails/stored/fontFiles')).toBe(true);
  });

  it('rejects more than five pages', () => {
    const x = load('equipe.im.json');
    x.source.pages = Array.from({ length: 6 }, () => x.source.pages[0]) as typeof x.source.pages;
    expect(issuesOf(x).some((i) => i.path === '/source/pages')).toBe(true);
  });

  it('rejects uppercase hex', () => {
    const x = load('equipe.im.json');
    x.observed.color[0]!.value.hex = '#F6F5F1';
    expect(issuesOf(x).some((i) => i.kind === 'schema')).toBe(true);
  });

  it('rejects ids that point nowhere', () => {
    const x = load('equipe.im.json');
    x.inferred.roles![0]!.dark = 'c99';
    x.inferred.typeRoles![0]!.style = 't99';
    x.inferred.roles![4]!.limit = 'L99';
    const ids = issuesOf(x).filter((i) => i.kind === 'reference').map((i) => i.message);
    expect(ids).toEqual(expect.arrayContaining(['unknown id c99', 'unknown id t99', 'unknown id L99']));
  });

  it('checks color ids inside state diffs', () => {
    const x = load('equipe.im.json');
    x.inferred.components![0]!.variants[0]!.states.hover.diff = { 'background-color': 'c3 -> c42' };
    expect(issuesOf(x).map((i) => i.message)).toContain('unknown id c42');
  });
});

describe('schema files', () => {
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
  const exportsOf = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).exports;

  it('exports both versions, so an explicit 0.1 import keeps working', () => {
    expect(exportsOf['./extract-0.1.schema.json']).toBe('./extract-0.1.schema.json');
    expect(exportsOf['./extract-0.2.schema.json']).toBe('./extract-0.2.schema.json');
  });

  it.each(['extract-0.1.schema.json', 'extract-0.2.schema.json'])('%s validates the 0.1 examples', (f) => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(read(f));
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      expect(validate(load(name)), `${f} ${name}`).toBe(true);
    }
  });

  it('0.2 also takes schemaVersion 0.2; 0.1 does not', () => {
    const x = { ...load('equipe.im.json'), schemaVersion: '0.2' };
    expect(new Ajv2020({ strict: true }).compile(read('extract-0.2.schema.json'))(x)).toBe(true);
    expect(new Ajv2020({ strict: true }).compile(read('extract-0.1.schema.json'))(x)).toBe(false);
  });
});
