import type { Command } from '../../../src/command.ts';

export const command: Command = {
  name: 'hello',
  summary: 'Say hello',
  async run() {
    return 0;
  },
};
