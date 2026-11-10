import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Extraction } from '@equipe-design/schema';
import { report } from './report.ts';

export interface RunFiles {
  dir: string;
  extractPath: string;
  reportPath: string;
}

/** One run = one folder: extract.json + report.md. Nothing else is written. */
export function writeRun(x: Extraction, dir: string): RunFiles {
  mkdirSync(dir, { recursive: true });
  const extractPath = join(dir, 'extract.json');
  const reportPath = join(dir, 'report.md');
  writeFileSync(extractPath, JSON.stringify(x, null, 2) + '\n');
  writeFileSync(reportPath, report(x));
  return { dir, extractPath, reportPath };
}
