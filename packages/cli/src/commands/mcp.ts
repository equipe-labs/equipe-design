import { SERVER_NAME, loadTools, serve } from '@equipe-design/mcp';
import { INTENDED_USE, version } from '../main.ts';
import type { Command } from '../command.ts';

export const command: Command = {
  name: 'mcp',
  summary: `Run the MCP server "${SERVER_NAME}" on stdio (design_extract, design_report, design_remix, design_emit)`,
  usage: [
    'Usage: equipe-design mcp',
    '',
    'Speaks MCP (JSON-RPC, one message per line) on stdin/stdout until stdin closes. Logs go to stderr.',
    'Register it as {"type":"stdio","command":"equipe-design","args":["mcp"]}.',
  ].join('\n'),
  async run(args) {
    if (args.length) {
      process.stderr.write(`equipe-design mcp: takes no options (got ${args.join(' ')})\n`);
      return 1;
    }
    const tools = await loadTools();
    await serve(tools, {
      name: SERVER_NAME,
      version: version(),
      instructions:
        'Extract → report limits to the person → remix with their brand → let them choose by the sheet pictures → emit. ' +
        'Results are files; answers carry paths and a summary. ' + INTENDED_USE,
    }, process.stdin, process.stdout, process.stderr);
    return 0;
  },
};
