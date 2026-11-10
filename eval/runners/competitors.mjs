#!/usr/bin/env node
// Runs one competitor extractor (designlang or dembrandt) on https://<host> with
// the same CLI flags as T-257, and writes the output in the T-257 `원본출력/` layout:
//
//   <out>/designlang/<host>/{design-tokens.json, dark-mode.json, ..., run.log, status.txt}
//   <out>/dembrandt/<host>/light/{<ts>_v0.39.2.json, <ts>_v0.39.2.tokens.json, theme.css, shadcn.css, run.log, status.txt}
//   <out>/dembrandt/<host>/dark-merged/{... same ..., DESIGN.md}
//
// Usage: node eval/runners/competitors.mjs --tool designlang|dembrandt --site <host> --out <dir>
// Tools come from eval/tools (npm install --prefix eval/tools).
// Browsers: designlang uses the system Chrome (--system-chrome -> Playwright channel "chrome");
// dembrandt uses the Playwright headless shell for its bundled playwright-core (as T-257 did).
// Never passes cookies or credentials.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearTimeout, setTimeout } from 'node:timers';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '../tools/node_modules');
const DESIGNLANG_BIN = join(TOOLS, 'designlang/bin/design-extract.js');
const DEMBRANDT_BIN = join(TOOLS, 'dembrandt/dist/index.js');
const TIMEOUT_MS = 300_000;
const TIMEOUT_EXIT = 124;

// The designlang files T-257 kept (written as `x-<name>`, stored without the prefix).
const DESIGNLANG_FILES = [
  'DESIGN.md', 'anatomy.tsx', 'dark-mode.json', 'design-language.md', 'design-tokens.json',
  'figma-variables.json', 'form-states.json', 'icon-system.json', 'intent.json', 'library.json',
  'mcp.json', 'seo.json', 'shadcn-theme.css', 'stack-intel.json', 'tailwind-v4.css',
  'variables.css', 'visual-dna.json', 'voice.json',
];

const DEMBRANDT_COMMON = ['--dtcg', '--tailwind', 'theme.css', '--shadcn', 'shadcn.css', '--save-output', '--wcag', '--no-headed-fallback'];
const DEMBRANDT_RUNS = {
  light: (url) => [url, ...DEMBRANDT_COMMON],
  'dark-merged': (url) => [url, '--dark-mode', '--dtcg', '--tailwind', 'theme.css', '--shadcn', 'shadcn.css', '--design-md', '--save-output', '--wcag', '--no-headed-fallback'],
};

function childEnv() {
  const env = { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1', PUPPETEER_SKIP_DOWNLOAD: '1' };
  delete env.DEMBRANDT_KEY; // no account sync
  delete env.BROWSER_CDP_ENDPOINT; // no attaching to a signed-in browser
  return env;
}

/** Runs node <bin> <args> in cwd, logging stdout+stderr to logPath. Resolves {exitCode, secs}. */
function runLogged(bin, args, { cwd, logPath }) {
  return new Promise((resolvePromise, reject) => {
    const start = Date.now();
    const log = createWriteStream(logPath);
    const child = spawn(process.execPath, [bin, ...args], {
      cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); log.end(); reject(err); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - start) / 1000);
      const exitCode = timedOut ? TIMEOUT_EXIT : (code ?? 128);
      if (timedOut) log.write(`\n[competitors] killed after ${TIMEOUT_MS / 1000}s timeout\n`);
      else if (signal) log.write(`\n[competitors] terminated by ${signal}\n`);
      log.end(() => resolvePromise({ exitCode, secs }));
    });
  });
}

const writeStatus = (dir, { exitCode, secs }) => writeFile(join(dir, 'status.txt'), `exit=${exitCode} secs=${secs}\n`);

async function runDesignlang(host, outDir) {
  const dir = join(outDir, 'designlang', host);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const raw = await mkdtemp(join(tmpdir(), 'designlang-'));
  try {
    const args = [`https://${host}`, '--dark', '--interactions', '--system-chrome', '-o', raw, '-n', 'x', '--no-history'];
    const res = await runLogged(DESIGNLANG_BIN, args, { cwd: raw, logPath: join(dir, 'run.log') });
    const present = new Set(await readdir(raw));
    for (const name of DESIGNLANG_FILES) {
      if (present.has(`x-${name}`)) await cp(join(raw, `x-${name}`), join(dir, name));
    }
    await writeStatus(dir, res);
    return { ...res, dir };
  } finally {
    await rm(raw, { recursive: true, force: true });
  }
}

async function runDembrandtMode(host, outDir, mode) {
  const dir = join(outDir, 'dembrandt', host, mode);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const res = await runLogged(DEMBRANDT_BIN, DEMBRANDT_RUNS[mode](`https://${host}`), { cwd: dir, logPath: join(dir, 'run.log') });
  // dembrandt saves JSON/DTCG/DESIGN.md under ./output/<domain>/; T-257 flattened them into the run dir.
  const outputRoot = join(dir, 'output');
  const domains = await readdir(outputRoot).catch(() => []);
  for (const domain of domains) {
    for (const f of await readdir(join(outputRoot, domain))) await rename(join(outputRoot, domain, f), join(dir, f));
  }
  await rm(outputRoot, { recursive: true, force: true });
  await writeStatus(dir, res);
  return { ...res, dir };
}

/**
 * Runs one tool on https://<host>. Returns {exitCode, secs, dir}.
 * For dembrandt both runs (light, dark-merged) happen; exitCode is the first non-zero
 * (else 0), secs the total, dir the <out>/dembrandt/<host> parent; per-mode results in `runs`.
 */
export async function runCompetitor({ tool, host, outDir }) {
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host ?? '') || host.includes('..')) throw new Error(`bad host: ${host}`);
  if (!outDir) throw new Error('outDir is required');
  const out = resolve(outDir);
  if (tool === 'designlang') return runDesignlang(host, out);
  if (tool === 'dembrandt') {
    const runs = {};
    for (const mode of ['light', 'dark-merged']) runs[mode] = await runDembrandtMode(host, out, mode);
    const all = Object.values(runs);
    return {
      exitCode: all.find((r) => r.exitCode !== 0)?.exitCode ?? 0,
      secs: all.reduce((s, r) => s + r.secs, 0),
      dir: join(out, 'dembrandt', host),
      runs,
    };
  }
  throw new Error(`unknown tool: ${tool} (designlang|dembrandt)`);
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--tool', '--site', '--out'].includes(key) || i + 1 >= argv.length) {
      throw new Error('usage: competitors.mjs --tool designlang|dembrandt --site <host> --out <dir>');
    }
    opts[key.slice(2)] = argv[++i];
  }
  if (!opts.tool || !opts.site || !opts.out) throw new Error('usage: competitors.mjs --tool designlang|dembrandt --site <host> --out <dir>');
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { tool, site, out } = parseArgs(process.argv.slice(2));
    const res = await runCompetitor({ tool, host: site, outDir: out });
    const detail = res.runs ? Object.entries(res.runs).map(([m, r]) => `${m}: exit=${r.exitCode} secs=${r.secs}`).join(', ') : `exit=${res.exitCode} secs=${res.secs}`;
    console.log(`${tool} ${site} -> ${res.dir} (${detail})`);
    process.exitCode = res.exitCode;
  } catch (err) {
    console.error(err.message);
    process.exitCode = 2;
  }
}
