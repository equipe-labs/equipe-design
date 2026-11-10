import { readdirSync, readFileSync } from 'node:fs';
import type { Command } from './command.ts';

export type { Command };

const COMMANDS_DIR = new URL('./commands/', import.meta.url);

export const INTENDED_USE =
  "Intended use: analysing your own sites and services, learning and inspiration. Don't use it to reproduce someone else's brand. " +
  "Signing in for a crawl is your own account and responsibility, as is following each site's terms. This is not legal advice.";

/** Every `commands/*.ts` (or built `.js`) that exports `command`, sorted by name. */
export async function loadCommands(dir: URL = COMMANDS_DIR): Promise<Command[]> {
  const files = readdirSync(dir).filter((f) => /\.(ts|js)$/.test(f) && !/\.(d|test)\.ts$/.test(f));
  const commands: Command[] = [];
  for (const f of files) {
    const mod = (await import(new URL(f, dir).href)) as { command?: Command };
    if (!mod.command) throw new Error(`commands/${f} does not export \`command\``);
    commands.push(mod.command);
  }
  const names = new Set<string>();
  for (const c of commands) {
    if (names.has(c.name)) throw new Error(`two commands are named "${c.name}"`);
    names.add(c.name);
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

export function helpText(commands: Command[]): string {
  const width = Math.max(0, ...commands.map((c) => c.name.length));
  const list = commands.length
    ? commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`).join('\n')
    : '  (none yet)';
  return [
    'Usage: equipe-design <command> [options]',
    '',
    'Extract design tokens from pages, remix them into your own brand, and export a design system.',
    '',
    'Commands:',
    list,
    '',
    'Options:',
    '  -h, --help     Show this help',
    '  -v, --version  Show the version',
    '',
    INTENDED_USE,
    '',
  ].join('\n');
}

export async function main(argv: string[], out = process.stdout, err = process.stderr): Promise<number> {
  const commands = await loadCommands();
  const [first, ...rest] = argv;
  if (first === undefined || first === '-h' || first === '--help' || first === 'help') {
    out.write(helpText(commands));
    return 0;
  }
  if (first === '-v' || first === '--version') {
    out.write(`${version()}\n`);
    return 0;
  }
  const command = commands.find((c) => c.name === first);
  if (!command) {
    err.write(`equipe-design: unknown command "${first}"\n\n${helpText(commands)}`);
    return 1;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    out.write(`${command.usage ?? `Usage: equipe-design ${command.name} [options]`}\n\n${command.summary}\n`);
    return 0;
  }
  return command.run(rest);
}
