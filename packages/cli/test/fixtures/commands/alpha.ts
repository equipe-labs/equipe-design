import type { Command } from '../../../src/command.ts';

export const command: Command = {
  name: 'alpha',
  summary: 'First in the list',
  async run(args) {
    return args.length;
  },
};
