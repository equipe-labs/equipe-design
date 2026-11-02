# Commands

Each file here is one command and exports `command` (see `../command.ts`). `main.ts` loads
every `*.ts` file in this folder, so adding a command never touches a shared file.

```ts
import type { Command } from '../command.ts';

export const command: Command = {
  name: 'report',
  summary: 'Print the evidence and limits report for an extract.json',
  async run(args) {
    return 0;
  },
};
```
