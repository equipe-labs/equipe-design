// renderSheet starts Chrome with a new, empty profile of its own and deletes it after.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSource, remix, renderSheet } from '../src/index.ts';

const example = JSON.parse(readFileSync(new URL('../../schema/examples/equipe.im.json', import.meta.url), 'utf8'));

describe('renderSheet', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eqd-sheet-test-'));
    // A stand-in Chrome: records its arguments, whether the profile existed while it ran, and writes the PNG.
    const fake = join(dir, 'chrome');
    writeFileSync(
      fake,
      `#!/bin/sh
for a in "$@"; do
  echo "$a" >> "${dir}/args"
  case "$a" in
    --user-data-dir=*) p="\${a#--user-data-dir=}"; [ -d "$p" ] && [ -z "$(ls -A "$p")" ] && echo yes > "${dir}/fresh";;
    --screenshot=*) : > "\${a#--screenshot=}";;
  esac
done
`,
    );
    chmodSync(fake, 0o755);
    vi.stubEnv('CHROME_PATH', fake);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses a fresh temporary --user-data-dir and removes it afterwards', () => {
    const r = remix([loadSource(example)], { color: '#0f766e', name: 'acme' })[0]!;
    const png = join(dir, 'out', 'sheet.png');
    expect(renderSheet(r, png)).toBe(true);
    const args = readFileSync(join(dir, 'args'), 'utf8').trim().split('\n');
    const profiles = args.filter((a) => a.startsWith('--user-data-dir='));
    expect(profiles).toHaveLength(1);
    const profile = profiles[0]!.slice('--user-data-dir='.length);
    expect(profile.startsWith(tmpdir())).toBe(true);
    expect(readFileSync(join(dir, 'fresh'), 'utf8').trim()).toBe('yes');
    expect(args.some((a) => /^--remote-debugging-(port|address)/.test(a))).toBe(false);
    expect(existsSync(profile)).toBe(false);
  });

  it('removes the profile even when Chrome fails', () => {
    writeFileSync(join(dir, 'chrome'), `#!/bin/sh\nfor a in "$@"; do echo "$a" >> "${dir}/args"; done\nexit 3\n`);
    const r = remix([loadSource(example)], { color: '#0f766e', name: 'acme' })[0]!;
    expect(() => renderSheet(r, join(dir, 'sheet.png'))).toThrow();
    const profile = readFileSync(join(dir, 'args'), 'utf8').split('\n').find((a) => a.startsWith('--user-data-dir='))!.slice('--user-data-dir='.length);
    expect(existsSync(profile)).toBe(false);
  });

  it('returns false without Chrome', () => {
    vi.stubEnv('CHROME_PATH', join(dir, 'no-chrome'));
    const r = remix([loadSource(example)], { color: '#0f766e', name: 'acme' })[0]!;
    expect(renderSheet(r, join(dir, 'sheet.png'))).toBe(false);
  });
});
