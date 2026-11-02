import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { helpText, loadCommands, main } from '../src/main.ts';

const bin = fileURLToPath(new URL('../bin/equipe-design.js', import.meta.url));

describe('equipe-design CLI', () => {
  it('--help lists the registered commands and the intended use', () => {
    const out = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    expect(out).toContain('Commands:\n');
    for (const name of ['extract', 'report', 'remix', 'emit']) expect(out).toMatch(new RegExp(`\\n {2}${name} `));
    expect(out).toContain('Intended use:');
  });

  it('fails on an unknown command', async () => {
    let err = '';
    const code = await main(['nope'], process.stdout, { write: (s: string) => ((err += s), true) } as never);
    expect(code).toBe(1);
    expect(err).toContain('unknown command "nope"');
  });

  it('registers every file in commands/ by itself, sorted', async () => {
    const commands = await loadCommands(new URL('./fixtures/commands/', import.meta.url));
    expect(commands.map((c) => c.name)).toEqual(['alpha', 'hello']);
    expect(helpText(commands)).toMatch(/Commands:\n {2}alpha {2}First in the list\n {2}hello {2}Say hello\n/);
  });
});
