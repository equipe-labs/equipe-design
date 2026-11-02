import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { path } from '../args.ts';
import { readExtraction } from '../engine.ts';
import { renderReport } from '../report.ts';
import type { Tool } from '../tool.ts';

/** Keeps the answer short; the file has the rest. */
const MAX = 6000;

export const tool: Tool = {
  name: 'design_report',
  description: 'The report.md of an extraction: pages read, a summary and every limit with how to fix it. Tell the person the limits briefly.',
  inputSchema: {
    type: 'object',
    properties: { extractPath: { type: 'string', description: 'extract.json from design_extract.' } },
    required: ['extractPath'],
    additionalProperties: false,
  },
  async handler(args) {
    const extractPath = path(args, 'extractPath');
    const beside = join(dirname(extractPath), 'report.md');
    const text = existsSync(beside) ? readFileSync(beside, 'utf8') : renderReport(readExtraction(extractPath));
    return text.length > MAX ? `${text.slice(0, MAX)}\n\n… (cut; the full report is ${beside})\n` : text;
  },
};
