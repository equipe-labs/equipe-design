import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { main } from '../src/main.ts';

const example = fileURLToPath(new URL('../../schema/examples/equipe.im.json', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'eqd-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const quiet = { write: () => true } as never;
const run = (args: string[]) => main(args, quiet, quiet);

describe('remix and emit commands', () => {
  it('remix writes tokens and remix.json for 3 variants; emit writes every format', async () => {
    const out = join(dir, 'r');
    const hush = (await run(['remix', example, '--brand', '#0f766e', '--name', 'acme', '--out', out, '--no-sheet'])) ;
    expect(hush).toBe(0);
    const meta = JSON.parse(readFileSync(join(out, 'b/remix.json'), 'utf8'));
    expect(meta.contrast.fails).toEqual([]);
    expect(meta.forbiddenLabels).toContain('equipe');
    const e = join(dir, 'e');
    expect(await run(['emit', join(out, 'a/tokens'), '--to', 'dtcg,css,tailwind,shadcn,swift,kotlin', '--out', e])).toBe(0);
    expect(readFileSync(join(e, 'tokens.css'), 'utf8')).toContain('--eq-color-primary: #0f766e;');
  });

  it('refuses --keep-brand alone (exit 2) and accepts it with --own-site', async () => {
    const out = join(dir, 'k');
    expect(await run(['remix', example, '--name', 'acme', '--keep-brand', '--out', out, '--no-sheet'])).toBe(2);
    expect(await run(['remix', example, '--name', 'acme', '--keep-brand', '--own-site', '--variants', '1', '--out', out, '--no-sheet'])).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'a/remix.json'), 'utf8')).meta.brand).toMatchObject({ kept: true, ownSite: true });
  });

  it('emit fails (exit 1) when a source label is in a token name', async () => {
    const out = join(dir, 'g');
    await run(['remix', example, '--brand', '#0f766e', '--name', 'acme', '--variants', '1', '--out', out, '--no-sheet']);
    const f = join(out, 'a/tokens/semantic.json');
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j['equipe-type'] = j.type;
    writeFileSync(f, JSON.stringify(j));
    expect(await run(['emit', join(out, 'a/tokens'), '--to', 'css', '--out', join(dir, 'g-out')])).toBe(1);
  });
});
