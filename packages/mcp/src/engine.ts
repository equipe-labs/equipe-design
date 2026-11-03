// What `design_extract` runs: the real engine (`@equipe-design/engine`'s `mcpEngine`).
// The fake engine answers only for the schema's example sites and is for tests:
// `EQUIPE_DESIGN_ENGINE=fake` (or setEngine) picks it on purpose; it is never a fallback.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateExtraction, type Extraction } from '@equipe-design/schema';
import { assertOwnBrowser, type LaunchPlan } from './browser.ts';
import { renderReport } from './report.ts';

export interface ExtractRequest {
  /** 1–5 http(s) URLs, read into one extraction. */
  urls: string[];
  /** Folder for extract.json and report.md (created). */
  outDir: string;
  widths?: number[];
  modes?: 'auto' | 'light' | 'dark' | 'both';
  states?: boolean;
  /** The browser to start. Always the engine's own (see browser.ts); call assertOwnBrowser on it. */
  browser: LaunchPlan;
}

export interface ExtractOutcome {
  extractPath: string;
  reportPath: string;
}

export interface Engine {
  name: string;
  /** True when results are example data, not measured. */
  fake: boolean;
  extract(req: ExtractRequest): Promise<ExtractOutcome>;
}

const EXAMPLES = new URL('../../schema/examples/', import.meta.url);

/** Host → example file in packages/schema/examples. */
const FAKE_SITES: Record<string, string> = {
  'equipe.im': 'equipe.im.json',
  'dark-only.example': 'dark-only.json',
  'robots-blocked.example': 'robots-disallowed.json',
};

export const fakeEngine: Engine = {
  name: 'fake (schema examples, not measured)',
  fake: true,
  async extract(req) {
    assertOwnBrowser(req.browser);
    const hosts = req.urls.map((u) => new URL(u).hostname.replace(/^www\./, ''));
    const file = FAKE_SITES[hosts[0]!];
    if (!file) throw new Error(`the fake engine only knows ${Object.keys(FAKE_SITES).join(', ')} (the real engine is not installed yet)`);
    mkdirSync(req.outDir, { recursive: true });
    const extractPath = join(req.outDir, 'extract.json');
    const reportPath = join(req.outDir, 'report.md');
    copyFileSync(new URL(file, EXAMPLES), extractPath);
    writeFileSync(reportPath, renderReport(readExtraction(extractPath), { fake: true }));
    return { extractPath, reportPath };
  },
};

let override: Engine | undefined;

/** For tests: use this engine instead of looking one up. */
export function setEngine(engine: Engine | undefined): void {
  override = engine;
}

let real: Engine | undefined;

export async function getEngine(env: NodeJS.ProcessEnv = process.env): Promise<Engine> {
  if (override) return override;
  if (env.EQUIPE_DESIGN_ENGINE === 'fake') return fakeEngine;
  if (!real) {
    const { mcpEngine } = await import('@equipe-design/engine');
    real = {
      name: mcpEngine.name,
      fake: false,
      async extract(req) {
        assertOwnBrowser(req.browser);
        return mcpEngine.extract(req);
      },
    };
  }
  return real;
}

export function readExtraction(path: string): Extraction {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`no such file: ${p}`);
  const checked = validateExtraction(JSON.parse(readFileSync(p, 'utf8')));
  if (!checked.ok) throw new Error(`${p} is not a valid extraction (schema 0.1): ${checked.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return checked.value;
}
