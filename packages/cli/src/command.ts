/**
 * One CLI command. Each file in `commands/` exports `command`; main.ts picks it up, so a
 * ticket adds its own file without touching anything shared.
 */
export interface Command {
  name: string;
  /** One line for `--help`. */
  summary: string;
  /** Usage line(s) for `equipe-design <name> --help`. */
  usage?: string;
  /** Exit code: 0 ok, 2 stopped by a guardrail (robots, login), 1 error. */
  run(args: string[]): Promise<number>;
}
