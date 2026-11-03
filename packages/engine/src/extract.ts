import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright-core';
import type { Extraction, Mode, ModeObservation } from '@equipe-design/schema';
import type { Rgba } from './capture/inpage.ts';
import { callInPage, forceStates, hideCookieBanners, launchBrowser, openPage, pageExtras, scanStylesheets, type OpenedPage } from './capture/page.ts';
import { DELAY_BETWEEN_PAGES_MS, MAX_PAGES, planPages, sleep } from './guard/budget.ts';
import { RobotsGuard, type RobotsDecision } from './guard/robots.ts';
import { detectWall, type Wall } from './guard/session.ts';
import { lightness, round, toHex } from './analyze/color.ts';
import { buildComponents, findCandidates, statePaths, type Candidate } from './analyze/components.ts';
import { inferBrand, inferRoles, inferTypeRoles } from './analyze/infer.ts';
import { Limits } from './analyze/limits.ts';
import type { PageData } from './analyze/model.ts';
import { finishLateColors, observe } from './analyze/observe.ts';
import { inferFontScale, inferScale } from './analyze/scale.ts';

export const VERSION: string = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
export const REPO_URL = 'https://github.com/equipe-labs/equipe-design';
export const USER_AGENT_TOKEN = `equipe-design/${VERSION} (+${REPO_URL})`;
export const NOTICE =
  "Values observed on the pages below, for analysis and inspiration. Not affiliated with the site's owner. Token names are neutral and new; no CSS, font, image or text was copied.";

export interface ExtractOptions {
  widths?: number[];
  modes?: 'auto' | 'light' | 'dark' | 'both';
  states?: boolean;
  /** Progress lines for the CLI (stderr). */
  log?: (line: string) => void;
  /** For tests: a fetch for robots.txt. */
  fetch?: typeof fetch;
}

export interface ExtractResult {
  extraction: Extraction;
  /** 0 ok, 2 stopped by a guardrail. */
  exitCode: 0 | 2;
  /** Every request the browser made (tests check the guardrails with it). */
  requests: string[];
}

type PageRecord = Extraction['source']['pages'][number];

interface DarkDetect {
  method: ModeObservation['method'] | null;
  mediaRules: number;
  toggles: string[];
  toggled: string | null;
  mediaVariables: number;
  defaultDark: boolean;
}

const TOGGLE_LABEL: Record<string, string> = {
  'class:dark': 'html.dark',
  'class:theme-dark': '.theme-dark',
  'class:dark-theme': '.dark-theme',
  'data-theme': '[data-theme=dark]',
  'data-mode': '[data-mode=dark]',
  'data-color-mode': '[data-color-mode=dark]',
  'data-color-scheme': '[data-color-scheme=dark]',
  'data-bs-theme': '[data-bs-theme=dark]',
};

export async function extract(urls: string[], opts: ExtractOptions = {}): Promise<ExtractResult> {
  const started = new Date();
  const t0 = performance.now();
  const log = opts.log ?? (() => undefined);
  const widths = (opts.widths?.length ? opts.widths : [1440, 390]).slice(0, 3);
  const modesOpt = opts.modes ?? 'auto';
  const statesEnabled = opts.states !== false;
  const limits = new Limits();
  const plan = planPages(urls, MAX_PAGES);
  if (!plan.accepted.length) throw new Error(`no readable URL in: ${urls.join(' ')}`);

  const robots = new RobotsGuard(USER_AGENT_TOKEN, opts.fetch);
  const decisions: RobotsDecision[] = [];
  for (const u of plan.accepted) decisions.push(await robots.check(u));

  const pageRecords: PageRecord[] = plan.accepted.map((u, i) => ({
    url: u.href,
    finalUrl: null,
    status: null,
    robots: { checked: decisions[i]!.checked, allowed: decisions[i]!.allowed, rule: decisions[i]!.rule },
    loginWall: false,
    visibleElements: 0,
    widths: [],
    modes: [],
  }));

  const blockedByRobots = decisions.map((d) => !d.allowed);
  for (const [i, d] of decisions.entries()) {
    if (d.allowed) continue;
    limits.add('robots-disallowed', plan.accepted.length === 1 ? '*' : `source.pages.${i}`, d.rule ? `robots.txt의 '${d.rule}' 규칙이 이 경로를 막음(UA equipe-design 기준)` : (d.note ?? 'robots.txt가 막음'), '페이지를 열지 않아 아무 값도 없음', 'robots.txt가 허용하는 페이지를 주거나, 내 사이트라면 robots.txt에 허용 규칙을 더하기');
  }

  if (plan.overCap.length) {
    limits.add('page-cap-reached', '*', `URL ${plan.accepted.length + plan.overCap.length}개 중 앞의 ${MAX_PAGES}개만 읽음(실행당 상한)`, `빠진 URL: ${plan.overCap.length}개`, '나머지는 다른 실행으로 나눠 읽기');
  }
  if (plan.otherOrigin.length) {
    limits.add('page-cap-reached', 'source.pages', `첫 URL과 출처가 다른 URL ${plan.otherOrigin.length}개는 읽지 않음(같은 출처만)`, '그 페이지의 값은 없음', '출처마다 따로 실행하기');
  }
  if (plan.accepted.length === 1) limits.add('single-page', '*', '사용자가 준 URL 1개만 읽음', '다른 페이지에만 있는 컴포넌트·색은 빠짐', 'URL을 더 주기(최대 5개)');

  const pages: PageData[] = [];
  const candidatesByPage = new Map<number, { candidates: Candidate[]; mode: Mode; width: number }>();
  let browser: Browser | null = null;
  let chromeVersion: string | null = null;
  let mutating = 0;
  const requests: string[] = [];
  const walls: Wall[] = [];
  const dark: DarkDetect = { method: null, mediaRules: 0, toggles: [], toggled: null, mediaVariables: 0, defaultDark: false };
  let stylesheets = { readable: 0, crossOriginParsedInMemory: 0, unreadable: 0 };
  let iframes = 0;
  let canvases = 0;
  let bannersHidden = 0;
  let timedOut = false;
  let visited = 0;

  try {
    for (const [i, url] of plan.accepted.entries()) {
      if (blockedByRobots[i]) continue;
      if (visited > 0) await sleep(DELAY_BETWEEN_PAGES_MS);
      if (!browser) {
        browser = await launchBrowser();
        chromeVersion = browser.version();
      }
      log(`읽는 중 ${url.href}`);
      const maxW = Math.max(...widths);
      const opened = await openPage(browser, url, { width: maxW, userAgent: await userAgentFor(browser) });
      visited++;
      try {
        const rec = pageRecords[i]!;
        rec.status = opened.status;
        rec.finalUrl = opened.finalUrl?.href ?? null;
        if (opened.timedOut) timedOut = true;
        const check = await callInPage(opened.page, 'pageCheck');
        const wall = detectWall({ status: opened.status, requestedUrl: url, finalUrl: opened.finalUrl, check });
        if (wall.wall) {
          walls.push(wall.wall);
          rec.loginWall = wall.wall === 'login-required';
          limits.add(
            wall.wall,
            plan.accepted.length === 1 ? '*' : `source.pages.${i}`,
            `${wall.reason} — 멈춤, 우회하지 않음`,
            '이 페이지의 값은 읽지 않음',
            wall.wall === 'login-required' ? '로그인 없이 열리는 공개 페이지를 주기(로그인 수집은 하지 않음)' : '사람이 보는 공개 페이지를 주거나 나중에 다시 시도',
          );
          continue;
        }
        const data = await capturePage(opened, i, widths, modesOpt, statesEnabled, dark, log);
        pages.push(data.page);
        candidatesByPage.set(i, data.cand);
        rec.visibleElements = data.visible;
        rec.widths = [...new Set(data.page.sweeps.map((s) => s.width))];
        rec.modes = [...new Set(data.page.sweeps.map((s) => s.mode))];
        stylesheets = {
          readable: stylesheets.readable + data.sheets.scan.readable,
          crossOriginParsedInMemory: stylesheets.crossOriginParsedInMemory + data.sheets.crossOriginParsed,
          unreadable: stylesheets.unreadable + data.sheets.unreadable,
        };
        iframes += data.extras.iframes;
        canvases += data.extras.canvases;
        bannersHidden += data.banners;
      } finally {
        mutating += opened.mutatingBlocked();
        requests.push(...opened.requests);
        await opened.context.close();
      }
    }
  } finally {
    await browser?.close();
  }

  const stoppedBy: Extraction['run']['stoppedBy'] = pages.length
    ? null
    : blockedByRobots.every(Boolean)
      ? 'robots-disallowed'
      : walls.includes('login-required')
        ? 'login-required'
        : walls.includes('bot-challenge')
          ? 'bot-challenge'
          : blockedByRobots.some(Boolean)
            ? 'robots-disallowed'
            : null;

  const options: Extraction['run']['options'] = { widths: widths as [number, ...number[]], modes: modesOpt, states: statesEnabled, maxPages: MAX_PAGES };
  const guardRobots: Extraction['guardrails']['robots'] = decisions.some((d) => d.verdict === 'disallowed') ? 'disallowed' : decisions.every((d) => d.verdict === 'exempt') ? 'exempt' : 'allowed';
  const base = {
    schemaVersion: '0.1' as const,
    tool: { name: 'equipe-design' as const, version: VERSION, chrome: chromeVersion },
    run: { id: `${started.toISOString().replace(/[:.]/g, '-')}-${plan.accepted[0]!.hostname || 'file'}`, startedAt: started.toISOString(), durationMs: 0, userAgent: USER_AGENT_TOKEN, options, stoppedBy },
    notice: NOTICE,
  };
  const guardrails: Extraction['guardrails'] = {
    robots: guardRobots,
    loginUsed: false,
    freshBrowserProfile: true,
    pagesVisited: visited,
    maxPages: MAX_PAGES,
    mutatingRequestsBlocked: mutating,
    stored: { cssText: false, fontFiles: false, images: false, pageText: false, screenshots: false },
    brandNameInTokenNames: false,
  };

  if (!pages.length) {
    const stopLimit = limits.list.find((l) => ['robots-disallowed', 'login-required', 'bot-challenge'].includes(l.kind))?.id ?? limits.add('timeout', '*', '읽은 페이지가 없음', '값 없음', null);
    const x: Extraction = {
      ...base,
      source: {
        pages: pageRecords as Extraction['source']['pages'],
        modes: { light: { observed: false, limit: stopLimit }, dark: { observed: false, limit: stopLimit } },
        stylesheets,
      },
      observed: { color: [], typography: { families: [], styles: [] }, spacing: [], radius: [], shadow: [], motion: [], elevation: [], breakpoints: [], variables: [] },
      inferred: {},
      limits: limits.list,
      guardrails,
      summary: { colors: 0, roles: { filled: 0, empty: 0 }, brand: null, darkPairs: 0, components: 0, limits: limits.list.length, lowConfidence: [] },
    };
    x.run.durationMs = Math.round(performance.now() - t0);
    return { extraction: x, exitCode: stoppedBy ? 2 : 0, requests };
  }

  // ---------------------------------------------------------------- analysis
  const primary: Mode = dark.defaultDark ? 'dark' : 'light';
  const otherObserved = pages.some((p) => p.sweeps.some((s) => s.mode !== primary));
  const other: Mode | null = otherObserved ? (primary === 'light' ? 'dark' : 'light') : null;
  const obs = observe(pages, { primaryMode: primary });

  // dark limits
  let darkLimit: string | null = null;
  const tried = Object.values(TOGGLE_LABEL);
  const modeObs: Extraction['source']['modes'] = {
    light: { observed: false },
    dark: { observed: false },
  };
  const detectors: ModeObservation['detectors'] = {
    mediaQuery: { found: dark.mediaRules > 0, rules: dark.mediaRules },
    classToggle: { found: !!dark.toggled, ...(dark.toggled ? { selector: TOGGLE_LABEL[dark.toggled] ?? dark.toggled } : {}), tried: dark.toggles.length ? dark.toggles.map((t) => TOGGLE_LABEL[t] ?? t) : tried },
    mediaVariables: { found: dark.mediaVariables > 0, variablesThatDiffer: dark.mediaVariables },
  };
  if (dark.defaultDark) {
    darkLimit = limits.add('dark-only', 'inferred.roles.*.light', `기본 화면이 어둡고(배경 L ${round(lightness(obs.pageBackground.dark ?? [0, 0, 0, 1]), 2)}) prefers-color-scheme·클래스 토글·@media 변수 어디에도 라이트 값이 없음`, '역할의 light 칸이 빔. 지어낸 라이트 값은 내지 않음', '리믹스에서 라이트 만들기를 고르기');
    modeObs.light = { observed: false, limit: darkLimit };
    modeObs.dark = { observed: true, method: 'default', detectors };
  } else {
    modeObs.light = { observed: true, method: 'default' };
    if (other) modeObs.dark = { observed: true, method: dark.method ?? 'media-query', detectors };
    else if (modesOpt === 'light') {
      darkLimit = limits.add('mode-unobserved', 'inferred.roles.*.dark', '--modes light로 다크를 읽지 않음', '역할의 dark 칸이 빔', '--modes auto로 다시 실행');
      modeObs.dark = { observed: false, limit: darkLimit, detectors };
    } else if (dark.toggles.length) {
      darkLimit = limits.add('dark-not-detected', 'inferred.roles.*.dark', `스타일시트에 다크 선택자(${dark.toggles.map((t) => TOGGLE_LABEL[t] ?? t).join(', ')})가 있지만 켜도 화면이 바뀌지 않음`, '역할의 dark 칸이 빔', '다크 화면이 바로 열리는 URL을 주기');
      modeObs.dark = { observed: false, limit: darkLimit, detectors };
    } else {
      darkLimit = limits.add('no-dark-mode', 'inferred.roles.*.dark', 'prefers-color-scheme 규칙·다크 클래스·@media 변수 어디에도 다크 값이 없음', '역할의 dark 칸이 빔. 지어낸 다크 값은 내지 않음', '리믹스에서 다크 만들기를 고르기');
      modeObs.dark = { observed: false, limit: darkLimit, detectors };
    }
  }
  modeObs.highContrast = { observed: false, limit: limits.add('mode-unobserved', 'source.modes.highContrast', '고대비(prefers-contrast·forced-colors)와 밀도 모드는 읽지 않음', '고대비 값 없음(‘없음’이 아니라 ‘미관찰’)', null) };

  // components (first page that was read, widest width, primary mode)
  const p0 = pages[0]!;
  const cand = candidatesByPage.get(p0.index)!;
  const built = buildComponents({ page: p0.index, width: cand.width, mode: cand.mode, candidates: cand.candidates, states: statesEnabled ? p0.states : null, obs, limits, statesEnabled });
  const variantsOf = new Map<string, Set<string>>();
  for (const rec of obs.colors) {
    if (rec.mode !== primary) continue;
    const set = new Set<string>();
    for (const ek of rec.elements) {
      const v = built.variantOfElement.get(ek);
      if (v) set.add(v);
    }
    variantsOf.set(rec.id, set);
    if (rec.observed) rec.observed.spread = { sections: rec.sections.size, componentClusters: set.size };
  }
  const ring = [...built.ringColors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const brand = inferBrand(obs, primary, { themeColor: p0.themeColor, variantsOf, ringColors: built.ringColors });
  const buttons = built.components.flatMap((c) => c.variants.map((v) => ({ bg: v.fingerprint.background, fg: v.fingerprint.color, border: v.fingerprint.border, count: v.count, kind: c.kind, name: v.suggestedName })));
  const roles = inferRoles({ obs, primary, other, darkLimit, brand, buttons, ring });
  const typeRoles = inferTypeRoles(obs);

  // scales
  const spacingScale = inferScale(
    obs.spacing.map((s) => ({ value: s.value.value, count: s.count, sections: s.sections, declared: !!s.cssVariables?.length, full: false })).concat(declaredOnly(obs, /space|spacing|gap|gutter|^--s-?\d|^--sp-?\d/i, primary, p0, obs.spacing.map((s) => s.value.value))),
    'spacing',
  );
  const radiusScale = inferScale(
    obs.radius.map((r) => ({ value: r.value.value, count: r.count, sections: r.sections, declared: !!r.cssVariables?.length, full: r.kind === 'full' })).concat(declaredOnly(obs, /radius|rounded|^--r-?\d|corner/i, primary, p0, obs.radius.map((r) => r.value.value))),
    'radius',
  );
  const bodyStyle = typeRoles.find((t) => t.role === 'body')?.style;
  const fontScale = inferFontScale(
    sizesOf(obs),
    bodyStyle ? (obs.styles.find((s) => s.id === bodyStyle)?.size.value ?? null) : null,
  );

  // remaining limits
  const unusedVars = obs.variables.filter((v) => v.usedByElements === 0).length;
  if (unusedVars) limits.add('unused-on-page', 'observed.variables', `변수 ${unusedVars}개는 선언됐지만 이 페이지의 요소가 쓰지 않음`, '그 변수로만 있는 색은 count 0으로 남고 역할에서 빠질 수 있음', '그 값이 나오는 페이지를 주기');
  if (stylesheets.unreadable) limits.add('cross-origin-css', 'observed.variables', `다른 출처 스타일시트 ${stylesheets.unreadable}개를 읽지 못함(메모리 파싱도 실패)`, '그 시트의 변수 선언·다크 규칙은 빠짐. 계산 스타일 값은 그대로 있음', null);
  if (iframes) limits.add('iframe-skipped', '*', `iframe ${iframes}개 안은 읽지 않음(서드파티 위젯 제외)`, 'iframe 안의 값은 없음', null);
  if (canvases) limits.add('canvas', '*', `canvas ${canvases}개 안의 그림은 값으로 읽을 수 없음`, 'canvas·WebGL로 그린 색·모양은 빠짐', null);
  if (bannersHidden) limits.add('cookie-banner', '*', '쿠키·동의 배너를 숨김 CSS로 덮음(클릭하지 않음)', '배너 안 요소는 집계에서 뺌', null);
  if (timedOut) limits.add('timeout', '*', '페이지가 60초 안에 다 뜨지 않음', '늦게 뜬 부분은 빠졌을 수 있음', '나중에 다시 실행');
  limits.add('policy', 'observed.typography.families', '폰트 파일·이미지·로고·본문 텍스트·CSS 원문은 정책상 저장하지 않음', '글꼴은 이름·굵기·크기만, 근거는 셀렉터·좌표만', null);

  finishLateColors(obs);
  const colorsOut = obs.colors.map((c) => c.observed);
  const darkPairs = new Set<string>();
  for (const r of roles) if (r.light && r.dark) darkPairs.add(`${r.light}>${r.dark}`);
  for (const v of obs.variables) if (v.resolvesTo?.light && v.resolvesTo.dark && v.resolvesTo.light !== v.resolvesTo.dark) darkPairs.add(`${v.resolvesTo.light}>${v.resolvesTo.dark}`);
  const hexOf = new Map(colorsOut.map((c) => [c.id, c.value.hex]));
  const lowConfidence = [
    ...roles.filter((r) => (r.light || r.dark) && r.confidence < 0.5).map((r) => `inferred.roles.${r.role}`),
    ...(brand.confidence < 0.5 ? ['inferred.brand'] : []),
    ...built.components.filter((c) => c.confidence < 0.5).map((c) => `inferred.components.${c.id}`),
  ];

  const x: Extraction = {
    ...base,
    source: { pages: pageRecords as Extraction['source']['pages'], modes: modeObs, stylesheets },
    observed: {
      color: colorsOut,
      typography: { families: obs.families, styles: obs.styles.map((s) => without(s, 'keyset')) },
      spacing: obs.spacing.map((s) => without(s, 'sections')),
      radius: obs.radius.map((r) => without(r, 'sections')),
      shadow: obs.shadow,
      motion: obs.motion,
      elevation: obs.elevation,
      breakpoints: obs.breakpoints,
      variables: obs.variables,
    },
    inferred: {
      scales: { spacing: spacingScale, radius: radiusScale, fontSize: fontScale },
      roles,
      brand,
      typeRoles,
      components: built.components,
    },
    limits: limits.list,
    guardrails,
    summary: {
      colors: colorsOut.length,
      roles: { filled: roles.filter((r) => r.light || r.dark).length, empty: roles.filter((r) => !r.light && !r.dark).length },
      brand: brand.status === 'found' && brand.color ? `${brand.color} ${hexOf.get(brand.color)}` : brand.status,
      darkPairs: darkPairs.size,
      components: built.components.length,
      limits: limits.list.length,
      lowConfidence,
    },
  };
  x.run.durationMs = Math.round(performance.now() - t0);
  return { extraction: x, exitCode: 0, requests };
}

function without<T extends object, K extends keyof T>(o: T, key: K): Omit<T, K> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

/** Length variables in the scale's group whose value no element used (count 0). */
function declaredOnly(obs: ReturnType<typeof observe>, re: RegExp, mode: Mode, p: PageData, seen: number[]) {
  const out: { value: number; count: number; sections: number; declared: boolean; full: boolean }[] = [];
  const have = new Set(seen.map((v) => round(v, 1)));
  for (const v of obs.variables) {
    if (!re.test(v.name)) continue;
    const val = p.vars[mode]?.[v.name];
    if (val?.px == null || val.px <= 0) continue;
    const r = round(val.px, 1);
    if (have.has(r)) continue;
    have.add(r);
    out.push({ value: r, count: 0, sections: 0, declared: true, full: false });
  }
  return out;
}

function sizesOf(obs: ReturnType<typeof observe>) {
  const m = new Map<number, number>();
  for (const s of obs.styles) m.set(s.size.value, (m.get(s.size.value) ?? 0) + s.count);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value);
}

let cachedUA: string | null = null;
async function userAgentFor(browser: Browser): Promise<string> {
  if (cachedUA) return cachedUA;
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const ua = await page.evaluate(() => navigator.userAgent);
  await ctx.close();
  // Identify ourselves; keep the browser part so sites render the same page people see.
  cachedUA = `${ua.replace('HeadlessChrome', 'Chrome')} ${USER_AGENT_TOKEN}`;
  return cachedUA;
}

async function capturePage(
  opened: OpenedPage,
  index: number,
  widths: number[],
  modesOpt: NonNullable<ExtractOptions['modes']>,
  statesEnabled: boolean,
  dark: DarkDetect,
  log: (s: string) => void,
) {
  const { page } = opened;
  const banners = await hideCookieBanners(page);
  await callInPage(page, 'scroll');
  const sheets = await scanStylesheets(opened);
  const { scan } = sheets;
  const extras = await pageExtras(page);
  const names = [...new Set(scan.declarations.map((d) => d.name))];
  const scopes: Record<string, string[]> = {};
  for (const d of scan.declarations) if (!(scopes[d.name] ??= []).includes(d.selector) && scopes[d.name]!.length < 5) scopes[d.name]!.push(d.selector);
  const usage = await callInPage(page, 'countUsage', scan.usage);

  const maxW = Math.max(...widths);
  const sweeps: PageData['sweeps'] = [];
  const vars: PageData['vars'] = {};

  // Light (default) sweep at the widest width.
  const first = await callInPage(page, 'sweep');
  // Transitions are read from this first sweep; after it they are switched off so mode and
  // width changes are read at their final values, not halfway through a fade.
  const freeze = () => page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation-duration:0s!important}' }).catch(() => undefined);
  await freeze();
  const bodyBg = first.elements.find((e) => e.tag === 'body');
  const htmlBg = first.elements.find((e) => e.tag === 'html');
  const bgIdx = bodyBg && bodyBg.bg >= 0 && first.colors[bodyBg.bg]![3] > 0.9 ? bodyBg.bg : (htmlBg?.bg ?? -1);
  const bgColor: Rgba = bgIdx >= 0 ? first.colors[bgIdx]! : [255, 255, 255, 1];
  const darkVarDecls = scan.declarations.filter((d) => (d.condition && /prefers-color-scheme:\s*dark/.test(d.condition)) || /\.dark\b|=["']?dark/.test(d.selector));
  const toggles = Object.keys(scan.darkSelectors).sort((a, b) => (scan.darkSelectors[b] ?? 0) - (scan.darkSelectors[a] ?? 0));
  if (index === 0) {
    dark.mediaRules = scan.darkMediaRules;
    dark.toggles = toggles;
  }
  let defaultDark = lightness(bgColor) < 0.3 && scan.darkMediaRules === 0 && toggles.length === 0;
  if (index === 0) dark.defaultDark = defaultDark;
  let firstMode: Mode = defaultDark ? 'dark' : 'light';
  vars[firstMode] = await callInPage(page, 'resolveVars', { names, scopes });
  sweeps.push({ mode: firstMode, width: maxW, result: first });
  log(`  ${first.elements.length}개 요소, 배경 ${toHex(bgColor)}`);

  // The other mode: prefers-color-scheme first, then a class/data toggle.
  let darkMode: 'media' | string | null = null;
  const wantDark = modesOpt !== 'light' && !defaultDark;
  if (wantDark) {
    if (scan.darkMediaRules > 0) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await sleep(150);
      const r = await callInPage(page, 'sweep');
      if (changed(first, r)) {
        darkMode = 'media';
        if (index === 0) dark.method = 'media-query';
        vars.dark = await callInPage(page, 'resolveVars', { names, scopes });
        sweeps.push({ mode: 'dark', width: maxW, result: r });
      } else {
        await page.emulateMedia({ colorScheme: 'light' });
      }
    }
    if (!darkMode) {
      for (const t of toggles) {
        const ok = await callInPage(page, 'applyToggle', t);
        await sleep(100);
        const r = await callInPage(page, 'sweep');
        if (ok || changed(first, r)) {
          darkMode = t;
          if (index === 0) {
            dark.method = 'class-toggle';
            dark.toggled = t;
          }
          vars.dark = await callInPage(page, 'resolveVars', { names, scopes });
          sweeps.push({ mode: 'dark', width: maxW, result: r });
          break;
        }
        // undo in place: the toggle only touched <html>/<body> classes and attributes
        await callInPage(page, 'undoToggle');
        await sleep(50);
      }
    }
  }
  // A dark page whose dark rules or toggles change nothing is a dark-only page.
  if (!darkMode && !defaultDark && lightness(bgColor) < 0.3) {
    defaultDark = true;
    if (index === 0) dark.defaultDark = true;
    firstMode = 'dark';
    sweeps[0]!.mode = 'dark';
    vars.dark = vars.light;
    delete vars.light;
  }
  if (index === 0 && vars.light && vars.dark) {
    let n = 0;
    for (const name of new Set(darkVarDecls.map((d) => d.name))) {
      const a = vars.light[name];
      const b = vars.dark[name];
      if (a && b && a.raw !== b.raw) n++;
    }
    dark.mediaVariables = n;
    if (dark.method === null && n > 0) dark.method = 'media-variables';
  }

  // Narrower widths, each in the modes read above.
  const setMode = async (m: Mode) => {
    if (darkMode === 'media') await page.emulateMedia({ colorScheme: m === 'dark' ? 'dark' : 'light' });
    else if (darkMode && m === 'dark') await callInPage(page, 'applyToggle', darkMode);
  };
  for (const w of widths.filter((x) => x !== maxW)) {
    await page.setViewportSize({ width: w, height: 844 });
    await sleep(200);
    if (darkMode && darkMode !== 'media') {
      // class toggles were applied in place; take them off for the light sweep
      await callInPage(page, 'undoToggle');
      await sleep(100);
    } else await setMode(firstMode);
    sweeps.push({ mode: firstMode, width: w, result: await callInPage(page, 'sweep') });
    if (darkMode) {
      await setMode('dark');
      await sleep(100);
      sweeps.push({ mode: 'dark', width: w, result: await callInPage(page, 'sweep') });
    }
  }

  // Back to the widest width in the first mode for the component state pass.
  await page.setViewportSize({ width: maxW, height: 900 });
  if (darkMode && darkMode !== 'media') await callInPage(page, 'undoToggle');
  else await setMode(firstMode);
  await sleep(100);
  const base = await callInPage(page, 'sweep');
  const candidates = findCandidates(base);
  let states: PageData['states'] = {};
  if (statesEnabled && index === 0) {
    const paths = statePaths(candidates);
    log(`  상태 강제 ${paths.length}개 요소`);
    states = await forceStates(opened, paths).catch(() => ({}));
  }
  // The component pass uses `base`: same DOM as the state pass. Replace the first sweep's
  // element list for the widest width so element paths line up.
  const transitions = new Map(first.elements.map((e) => [e.path, e.transition]));
  for (const e of base.elements) e.transition = transitions.get(e.path) ?? e.transition;
  sweeps[0] = { mode: firstMode, width: maxW, result: base.elements.length >= first.elements.length * 0.8 ? base : first };

  const themeColor = first.themeColor;
  const pageData: PageData = { index, url: page.url(), sweeps, scan, vars, usage, themeColor, fonts: extras.fonts, states };
  return { page: pageData, cand: { candidates, mode: firstMode, width: maxW }, visible: first.elements.length, sheets, extras, banners };
}

function changed(a: { elements: { path: string; tag: string; bg: number; fg: number }[]; colors: Rgba[] }, b: typeof a): boolean {
  const key = (r: typeof a, i: number) => (i >= 0 ? r.colors[i]!.join(',') : '-');
  const m = new Map(a.elements.map((e) => [e.path, `${key(a, e.bg)}|${key(a, e.fg)}`]));
  let diff = 0;
  let n = 0;
  for (const e of b.elements) {
    // <html> keeps the browser's default colours, which flip with color-scheme alone (the toggle
    // sets it); whether the page itself changed starts at <body>.
    if (e.tag === 'html') continue;
    const prev = m.get(e.path);
    if (prev === undefined) continue;
    n++;
    if (prev !== `${key(b, e.bg)}|${key(b, e.fg)}`) diff++;
  }
  return n > 0 && diff / n > 0.05;
}
