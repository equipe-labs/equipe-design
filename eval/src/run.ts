/**
 * The eval: run the three tools on each site (or read a folder of earlier runs with `from`),
 * score them against eval/answers and write scoreboard.md + scores.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAnswer, EVAL_DIR, loadAnswer, loadSites, STALE_DAYS, staleDays } from './answers.ts';
import { readTool } from './adapters.ts';
import { METRIC_LABEL, score } from './score.ts';
import { TOOL_LABEL, TOOLS, type Answer, type Cell, type SiteSpec, type ToolName, type ToolResult } from './types.ts';

export interface EvalOptions {
  /** Score the runs already in this folder; run nothing. */
  from?: string;
  /** Where runs and the scoreboard go (default eval/out/<date>). */
  out?: string;
  tools?: ToolName[];
  sites?: string[];
  /** Include spare sites (vercel.com). */
  spare?: boolean;
  log?: (line: string) => void;
  today?: Date;
}

export interface SiteScore {
  host: string;
  rows: { metric: string; label: string; cells: Record<ToolName, Cell>; goal: string }[];
  results: Record<ToolName, ToolResult>;
}

export interface EvalResult {
  dir: string;
  scoreboardPath: string;
  sites: SiteScore[];
  warnings: string[];
  /** equipe-design rows that missed their goal. */
  misses: string[];
  markdown: string;
}

async function runEngine(host: string, url: string, dir: string, log: (l: string) => void): Promise<void> {
  const { extract, writeRun } = await import('@equipe-design/engine');
  const t0 = performance.now();
  try {
    const { extraction } = await extract([url], { log: (l) => log(`  ${l}`) });
    writeRun(extraction, dir);
    writeFileSync(join(dir, 'status.txt'), `exit=0 secs=${Math.round((performance.now() - t0) / 1000)}\n`);
  } catch (e) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'status.txt'), `exit=1 secs=${Math.round((performance.now() - t0) / 1000)}\nerror=${(e as Error).message}\n`);
    log(`  equipe-design failed: ${(e as Error).message}`);
  }
}

async function runCompetitorTool(tool: 'designlang' | 'dembrandt', host: string, root: string, log: (l: string) => void): Promise<void> {
  const tools = new URL('tools/node_modules/', EVAL_DIR);
  if (!existsSync(tools)) throw new Error('competitor tools are not installed: npm install --prefix eval/tools');
  const mod = (await import(new URL('runners/competitors.mjs', EVAL_DIR).href)) as {
    runCompetitor(o: { tool: string; host: string; outDir: string }): Promise<{ exitCode: number; secs: number }>;
  };
  const r = await mod.runCompetitor({ tool, host, outDir: root });
  log(`  ${tool}: exit ${r.exitCode}, ${r.secs}s`);
}

function cellText(c: Cell, goal: boolean): string {
  if (!goal || c.pass === undefined) return c.text;
  return c.pass ? c.text : `${c.text} ⚠︎`;
}

export function scoreSite(site: SiteSpec, a: Answer, root: string, tools: ToolName[]): SiteScore {
  const results = Object.fromEntries(TOOLS.map((t) => [t, readTool(t, root, site.host)])) as Record<ToolName, ToolResult>;
  const rows = site.metrics.map((m) => ({
    metric: m,
    label: METRIC_LABEL[m],
    goal: site.goals[m] ?? '',
    cells: Object.fromEntries(TOOLS.map((t) => [t, tools.includes(t) ? score(m, a, results[t]) : { text: '–' }])) as Record<ToolName, Cell>,
  }));
  return { host: site.host, rows, results };
}

export function renderScoreboard(sites: SiteScore[], answers: Map<string, Answer>, warnings: string[], misses: string[], meta: { date: string; root: string; secsGoal: number }): string {
  const L: string[] = [];
  L.push(`# equipe-design 정확도 평가 — ${meta.date}`, '');
  L.push(`실행 폴더: \`${meta.root}\`. 정답: \`eval/answers/<host>.json\`. 지표 정의: 설계 README 5.2, 이 폴더의 \`eval/README.md\`.`, '');
  L.push(`| 사이트 | 지표 | ${TOOLS.map((t) => TOOL_LABEL[t]).join(' | ')} | 목표 |`);
  L.push(`|---|---|${TOOLS.map(() => '---').join('|')}|---|`);
  for (const s of sites) {
    for (const r of s.rows) {
      L.push(`| ${s.host} | ${r.label} | ${TOOLS.map((t) => cellText(r.cells[t], t === 'equipe-design' && !!r.goal)).join(' | ')} | ${r.goal} |`);
    }
  }
  const secs = (t: ToolName) => {
    const v = sites.map((s) => s.results[t].secs).filter((n): n is number => n !== null);
    if (!v.length) return '–';
    const min = Math.min(...v);
    const max = Math.max(...v);
    return min === max ? `${min}초` : `${min}~${max}초`;
  };
  L.push(`| (전체) | 페이지당 시간 | ${TOOLS.map((t) => secs(t)).join(' | ')} | ≤ ${meta.secsGoal}초 |`, '');
  L.push('⚠︎ = equipe-design이 목표에 못 미친 칸. 셀의 `a/b · c/d`는 재현율 · 정밀도(정밀도 분모 = 도구가 낸 단계 수).', '');

  L.push('## 실행 상태', '');
  L.push(`| 사이트 | ${TOOLS.map((t) => TOOL_LABEL[t]).join(' | ')} |`, `|---|${TOOLS.map(() => '---').join('|')}|`);
  for (const s of sites) {
    L.push(`| ${s.host} | ${TOOLS.map((t) => {
      const r = s.results[t];
      return r.status === 'ok' ? `ok${r.secs !== null ? ` ${r.secs}초` : ''}` : `${r.status}${r.error ? ` (${r.error})` : ''}`;
    }).join(' | ')} |`);
  }
  L.push('');

  L.push('## equipe-design 미달 항목', '');
  L.push(misses.length ? misses.map((m) => `- ${m}`).join('\n') : '- 없음 (목표가 있는 칸 기준)', '');

  L.push('## 정답 출처', '');
  for (const s of sites) {
    const a = answers.get(s.host)!;
    L.push(`- **${s.host}** — checkedAt ${a.checkedAt}. ${a.sources.map((x) => `[${x.label}](${x.url})`).join(', ')}`);
  }
  L.push('');
  if (warnings.length) L.push('## 경고', '', ...warnings.map((w) => `- ${w}`), '');
  return L.join('\n');
}

export async function runEval(opts: EvalOptions = {}): Promise<EvalResult> {
  const log = opts.log ?? (() => undefined);
  const today = opts.today ?? new Date();
  const date = today.toISOString().slice(0, 10);
  const tools = opts.tools ?? TOOLS;
  const allSites = loadSites();
  const sites = allSites.filter((s) => (opts.sites?.length ? opts.sites.includes(s.host) : opts.spare || !s.spare));
  const root = resolve(opts.from ?? opts.out ?? fileURLToPath(new URL(`out/${date}/`, EVAL_DIR)));
  // Re-scoring someone else's folder never writes into it.
  const dir = resolve(opts.out ?? (opts.from ? fileURLToPath(new URL(`out/${date}-rescore/`, EVAL_DIR)) : root));
  mkdirSync(dir, { recursive: true });

  const warnings: string[] = [];
  const answers = new Map<string, Answer>();
  for (const s of sites) {
    const a = loadAnswer(s.host);
    if (!a) throw new Error(`no answer file for ${s.host} (eval/answers/${s.host}.json)`);
    for (const i of checkAnswer(a)) warnings.push(`${s.host}: ${i}`);
    const age = staleDays(a, today);
    if (age > STALE_DAYS) warnings.push(`${s.host}: 정답이 ${age}일 지났어요 (checkedAt ${a.checkedAt}) — 사이트가 바뀌었을 수 있으니 다시 확인하세요.`);
    answers.set(s.host, a);
  }

  if (!opts.from) {
    for (const s of sites) {
      const a = answers.get(s.host)!;
      log(`${s.host}`);
      if (tools.includes('equipe-design')) await runEngine(s.host, a.url, join(root, 'equipe-design', s.host), log);
      for (const t of ['designlang', 'dembrandt'] as const) if (tools.includes(t)) await runCompetitorTool(t, s.host, root, log);
    }
  }

  const scored = sites.map((s) => scoreSite(s, answers.get(s.host)!, root, tools));
  const misses: string[] = [];
  for (const s of scored) {
    for (const r of s.rows) {
      const c = r.cells['equipe-design'];
      if (r.goal && c.pass === false) misses.push(`${s.host} · ${r.label}: ${c.text} (목표 ${r.goal})`);
    }
    const t = s.results['equipe-design'].secs;
    if (t !== null && t > 30) misses.push(`${s.host} · 시간: ${t}초 (목표 ≤ 30초)`);
  }
  const markdown = renderScoreboard(scored, answers, warnings, misses, { date, root, secsGoal: 30 });
  const scoreboardPath = join(dir, 'scoreboard.md');
  writeFileSync(scoreboardPath, markdown);
  writeFileSync(join(dir, 'scores.json'), JSON.stringify({ date, root, warnings, misses, sites: scored.map(({ host, rows }) => ({ host, rows })) }, null, 2));
  return { dir, scoreboardPath, sites: scored, warnings, misses, markdown };
}
