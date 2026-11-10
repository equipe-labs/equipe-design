// Builds packages/api-contract/fixtures/ from real inputs with the real remix + emit code:
//   two originals (T-291 Hush, Klaxon) and one extracted style (the schema's equipe.im example, named "Tessel").
// `npm run gen:fixtures -w @equipe-design/api-contract` writes them; test/fixtures.test.ts checks they're current.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit, toDtcg, type DtcgFiles } from '@equipe-design/emit';
import { loadSource, remix, toOklch, type Source } from '@equipe-design/remix';
import type { Extraction } from '@equipe-design/schema';
import {
  NOTICE, PREVIEW_ROLES, REMIX_FORMATS, TYPE_ROLES,
  type ReleaseBody, type ReleaseUpload, type RemixRequest, type RemixResponse, type StyleCard,
  type StyleDetail, type StyleList, type StyleUpsert, type TokenFiles, type Meta,
} from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', 'fixtures');
const require = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as unknown;

const PUBLISHED_AT = '2026-11-02T09:30:00Z';
const REMIX_VERSION = (require(join(here, '..', '..', 'remix', 'package.json')) as { version: string }).version;
const ENGINE_VERSION = 'equipe-design 0.1.0';

interface Input {
  slug: string;
  entry: StyleUpsert;
  json: unknown;
  releaseId: string;
  runId?: string;
}

const extractPath = join(here, '..', '..', 'schema', 'examples', 'equipe.im.json');
export const INPUTS: Input[] = [
  {
    slug: 'hush',
    entry: {
      name: 'Hush', origin: 'original', description: 'Quiet greys, one blue for links. Minimal.', category: 'minimal', tags: ['neutral', 'light-first'],
      descriptionI18n: {
        ko: '조용한 회색에 링크만 파란색 하나. 미니멀.',
        ja: '静かなグレーに、リンクだけ青をひとつ。ミニマル。',
        'zh-CN': '安静的灰色，只有链接用一种蓝色。极简。',
        de: 'Ruhige Grautöne, ein Blau für Links. Minimalistisch.',
        fr: 'Des gris discrets, un seul bleu pour les liens. Minimaliste.',
        es: 'Grises tranquilos y un solo azul para los enlaces. Minimalista.',
        'pt-BR': 'Cinzas discretos e um único azul para os links. Minimalista.',
      },
    },
    json: require(join(FIXTURES_DIR, 'inputs', 'hush.tokens.json')),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a01',
  },
  {
    slug: 'klaxon',
    entry: {
      name: 'Klaxon', origin: 'original', description: 'Black, white and a loud yellow. High contrast.', category: 'high-contrast', tags: ['bold', 'accessible'],
      descriptionI18n: {
        ko: '검정, 흰색, 그리고 요란한 노랑. 고대비.',
        ja: '黒と白、そして目を引く黄色。ハイコントラスト。',
        'zh-CN': '黑、白，加上醒目的黄色。高对比度。',
        de: 'Schwarz, Weiß und ein lautes Gelb. Hoher Kontrast.',
        fr: 'Noir, blanc et un jaune criard. Contraste élevé.',
        es: 'Negro, blanco y un amarillo estridente. Alto contraste.',
        'pt-BR': 'Preto, branco e um amarelo berrante. Alto contraste.',
      },
    },
    json: require(join(FIXTURES_DIR, 'inputs', 'klaxon.tokens.json')),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a02',
  },
  {
    // Fixture only: a made-up style name for the schema's example extraction.
    slug: 'tessel',
    entry: {
      name: 'Tessel', origin: 'extracted', description: 'Deep blue on white with a matching dark theme.', category: 'devtool', tags: ['blue', 'dark-mode'],
      descriptionI18n: {
        ko: '흰 바탕에 짙은 파랑, 어울리는 다크 테마까지.',
        ja: '白地に深い青。対になるダークテーマ付き。',
        'zh-CN': '白底深蓝，配有相称的深色主题。',
        de: 'Tiefes Blau auf Weiß, mit passendem dunklem Theme.',
        fr: 'Un bleu profond sur fond blanc, avec un thème sombre assorti.',
        es: 'Azul profundo sobre blanco, con un tema oscuro a juego.',
        'pt-BR': 'Azul profundo sobre branco, com um tema escuro combinando.',
      },
      source: { serviceName: 'equipe.im', homepage: 'https://equipe.im/', allowedUrls: ['https://equipe.im/'] },
    },
    json: require(extractPath),
    releaseId: '6f1c2a40-5b7e-4c1a-9a51-0d3b8f0e1a03',
    runId: '0b7d9e52-3c1f-4e8a-b6d2-7a9c1e4f5b03',
  },
];

type Translated = { en: string } & NonNullable<StyleUpsert['descriptionI18n']>;
/**
 * Limit texts in every site language, by scope. On the Mac the publisher fills these before upload;
 * here they are written by hand. The engine's Korean limits for the extracted example are the `ko` text.
 */
const LIMIT_TEXT: Record<string, Translated> = {
  'fonts.mono': {
    en: 'the system has no monospace font, JetBrains Mono (OFL) is added',
    ko: '이 시스템에는 고정폭 글꼴이 없어 JetBrains Mono(OFL)를 더함',
    ja: 'このシステムには等幅フォントがないため、JetBrains Mono(OFL)を追加',
    'zh-CN': '该系统没有等宽字体，已补充 JetBrains Mono（OFL）',
    de: 'das System hat keine Monospace-Schrift, JetBrains Mono (OFL) wird ergänzt',
    fr: 'le système n’a pas de police à chasse fixe, JetBrains Mono (OFL) est ajoutée',
    es: 'el sistema no tiene fuente monoespaciada; se añade JetBrains Mono (OFL)',
    'pt-BR': 'o sistema não tem fonte monoespaçada; JetBrains Mono (OFL) foi adicionada',
  },
  '*': {
    en: 'Only the one URL given was read — components and colours that appear only on other pages are missing',
    ko: '사용자가 준 URL 1개만 읽음 — 다른 페이지에만 있는 컴포넌트·색은 빠짐',
    ja: '指定された URL 1 件だけを読み取り — 他のページにしかないコンポーネントや色は含まれない',
    'zh-CN': '只读取了给定的 1 个 URL — 仅出现在其他页面的组件和颜色未包含',
    de: 'Nur die eine angegebene URL wurde gelesen — Komponenten und Farben, die nur auf anderen Seiten vorkommen, fehlen',
    fr: 'Seule l’URL fournie a été lue — les composants et couleurs présents uniquement sur d’autres pages manquent',
    es: 'Solo se leyó la URL indicada — faltan los componentes y colores que solo aparecen en otras páginas',
    'pt-BR': 'Só a URL informada foi lida — componentes e cores que aparecem só em outras páginas ficaram de fora',
  },
  'observed.color': {
    en: 'Colours such as action-hover, action-pressed and err are not used on this page (only declared as variables) — some roles are empty',
    ko: 'action-hover·action-pressed·err 같은 색은 이 페이지에서 쓰이지 않음(변수로만 선언) — 역할 일부가 비어 있음',
    ja: 'action-hover・action-pressed・err などの色はこのページで使われていない(変数として宣言のみ) — 一部のロールが空',
    'zh-CN': 'action-hover、action-pressed、err 等颜色在此页面未被使用（仅声明为变量）— 部分角色为空',
    de: 'Farben wie action-hover, action-pressed und err werden auf dieser Seite nicht verwendet (nur als Variablen deklariert) — einige Rollen sind leer',
    fr: 'Des couleurs comme action-hover, action-pressed et err ne sont pas utilisées sur cette page (seulement déclarées en variables) — certains rôles sont vides',
    es: 'Colores como action-hover, action-pressed y err no se usan en esta página (solo se declaran como variables) — algunos roles quedan vacíos',
    'pt-BR': 'Cores como action-hover, action-pressed e err não são usadas nesta página (só declaradas como variáveis) — alguns papéis ficam vazios',
  },
  'inferred.components.k1.*.disabled': {
    en: 'The page has no disabled or error examples, and attributes are not injected by default — the disabled column of the state table and the destructive role are empty',
    ko: '페이지에 disabled·error 예시가 없음. 속성 주입은 기본으로 하지 않음 — 상태 표의 disabled 칸, destructive 역할이 빈칸',
    ja: 'ページに disabled・error の例がなく、属性の注入はデフォルトで行わない — 状態表の disabled 列と destructive ロールが空欄',
    'zh-CN': '页面上没有 disabled、error 示例，默认不注入属性 — 状态表的 disabled 列和 destructive 角色为空',
    de: 'Die Seite hat keine Beispiele für disabled oder error, und Attribute werden standardmäßig nicht eingefügt — die disabled-Spalte der Zustandstabelle und die Rolle destructive sind leer',
    fr: 'La page n’a aucun exemple disabled ou error, et aucun attribut n’est injecté par défaut — la colonne disabled du tableau d’états et le rôle destructive sont vides',
    es: 'La página no tiene ejemplos de disabled ni de error, y por defecto no se inyectan atributos — la columna disabled de la tabla de estados y el rol destructive quedan vacíos',
    'pt-BR': 'A página não tem exemplos de disabled nem de error, e atributos não são injetados por padrão — a coluna disabled da tabela de estados e o papel destructive ficam vazios',
  },
  'inferred.components.k1.k1v2.active': {
    en: 'Forcing :active made no difference to the computed style; the state may be drawn by JS — the pressed state is unconfirmed',
    ko: ':active 강제로 계산 스타일 차이가 없음. JS로 그리는 상태일 수 있음 — 눌림 상태 미확인',
    ja: ':active を強制しても計算済みスタイルに差がない。JS で描画される状態かもしれない — 押下状態は未確認',
    'zh-CN': '强制 :active 后计算样式没有差别，该状态可能由 JS 绘制 — 按下状态未确认',
    de: 'Erzwungenes :active ändert den berechneten Stil nicht; der Zustand wird womöglich per JS gezeichnet — der gedrückte Zustand ist unbestätigt',
    fr: 'Forcer :active ne change pas le style calculé ; l’état est peut-être dessiné en JS — l’état pressé n’est pas confirmé',
    es: 'Forzar :active no cambia el estilo calculado; el estado puede dibujarse con JS — el estado pulsado no está confirmado',
    'pt-BR': 'Forçar :active não muda o estilo calculado; o estado pode ser desenhado por JS — o estado pressionado não foi confirmado',
  },
  'source.modes.highContrast': {
    en: 'The stylesheets have no prefers-contrast: more rules — no high-contrast values (not observed, rather than absent)',
    ko: 'prefers-contrast: more 규칙이 스타일시트에 없음 — 고대비 값 없음(‘없음’이 아니라 ‘미관찰’)',
    ja: 'スタイルシートに prefers-contrast: more のルールがない — ハイコントラストの値なし(「存在しない」ではなく「未観測」)',
    'zh-CN': '样式表中没有 prefers-contrast: more 规则 — 无高对比度值（是“未观察到”，而非“不存在”）',
    de: 'Die Stylesheets enthalten keine prefers-contrast: more-Regeln — keine Hochkontrast-Werte (nicht beobachtet, nicht „nicht vorhanden“)',
    fr: 'Les feuilles de style n’ont aucune règle prefers-contrast: more — pas de valeurs de contraste élevé (non observées plutôt qu’absentes)',
    es: 'Las hojas de estilo no tienen reglas prefers-contrast: more — no hay valores de alto contraste (no observados, no inexistentes)',
    'pt-BR': 'As folhas de estilo não têm regras prefers-contrast: more — sem valores de alto contraste (não observados, e não inexistentes)',
  },
  'observed.typography.families': {
    en: 'Font files are not downloaded, by policy — fonts are names, weights and sizes only',
    ko: '폰트 파일은 정책상 받지 않음 — 글꼴은 이름·굵기·크기만',
    ja: 'フォントファイルはポリシー上ダウンロードしない — フォントは名前・ウェイト・サイズのみ',
    'zh-CN': '按政策不下载字体文件 — 字体只有名称、字重和字号',
    de: 'Schriftdateien werden grundsätzlich nicht geladen — Schriften nur mit Name, Stärke und Größe',
    fr: 'Par principe, les fichiers de police ne sont pas téléchargés — seulement les noms, graisses et tailles',
    es: 'Por política no se descargan archivos de fuentes — solo nombres, pesos y tamaños',
    'pt-BR': 'Por política, arquivos de fonte não são baixados — só nomes, pesos e tamanhos',
  },
};
function translate(scope: string): ReleaseBody['limits'][number] {
  const t = LIMIT_TEXT[scope];
  if (!t) throw new Error(`no translations for limit ${scope}; add it to LIMIT_TEXT`);
  const { en, ...textI18n } = t;
  return { scope, text: en, textI18n };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function body(src: Source, x: Extraction | null): ReleaseBody {
  const m = src.model;
  const roles = Object.fromEntries(TYPE_ROLES.map((r) => [r, m.type[r]!])) as ReleaseBody['typography']['roles'];
  let components: ReleaseBody['components'] = [];
  let limits: ReleaseBody['limits'];
  if (x) {
    const hex = new Map(x.observed.color.map((c) => [c.id, c.value.hex.toLowerCase()]));
    const h = (id: string | null | undefined) => (id ? (hex.get(id) ?? null) : null);
    components = (x.inferred.components ?? []).map((k) => ({
      kind: k.kind,
      variants: k.variants.map((v) => {
        const fp = v.fingerprint as { background?: string | null; color?: string | null; border?: string | null; radius?: { value: number; unit: string } | null };
        return {
          name: v.suggestedName ?? v.id,
          background: h(fp.background),
          text: h(fp.color),
          border: h(fp.border),
          radiusPx: fp.radius ? (fp.radius.unit === 'rem' ? fp.radius.value * 16 : fp.radius.value) : null,
          states: Object.fromEntries(Object.entries(v.states ?? {}).map(([s, st]) => [s, (st as { observed: boolean }).observed])),
        };
      }),
    }));
    limits = x.limits.map((l) => {
      const t = translate(l.scope);
      const engineText = [l.reason, l.effect].filter(Boolean).join(' — ');
      if (t.textI18n.ko !== engineText) throw new Error(`limit ${l.scope} changed in the example extract; update LIMIT_TEXT`);
      return t;
    });
  } else {
    limits = src.limits.map((l) => {
      const i = l.indexOf(': ');
      const t = i > 0 ? { scope: l.slice(0, i), text: l.slice(i + 2) } : { scope: '*', text: l };
      if (LIMIT_TEXT[t.scope]?.en !== t.text) throw new Error(`limit ${t.scope} changed in a library source; update LIMIT_TEXT`);
      return translate(t.scope);
    });
  }
  return {
    roles: { light: m.colors.light, dark: m.colors.dark },
    scales: { space: m.space, radius: m.radius },
    typography: { fonts: m.fonts, roles },
    components,
    limits,
  };
}

type Formats = Partial<Record<'dtcg' | 'dtcg-legacy' | 'css' | 'tailwind' | 'shadcn', Record<string, string>>>;
function tokens(dtcg: DtcgFiles, forbidden: string[]): Formats {
  const one = (f: 'dtcg' | 'css' | 'tailwind' | 'shadcn', legacy = false) => emit(dtcg, [f], { forbidden, legacy });
  return { dtcg: one('dtcg'), 'dtcg-legacy': one('dtcg', true), css: one('css'), tailwind: one('tailwind'), shadcn: one('shadcn') };
}

/** Builds every fixture file: path under fixtures/ -> JSON value (or text for .sql). */
export function buildFixtures(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cards: StyleCard[] = [];
  const library: unknown[] = [];
  const sources = new Map<string, Source>();
  const seed: string[] = [];
  const q = (v: unknown) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
  const qj = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
  const qa = (a: string[]) => `${q(`{${a.map((s) => `"${s.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`)}::text[]`;

  INPUTS.forEach((input, i) => {
    const { slug, entry } = input;
    const x = entry.origin === 'extracted' ? (input.json as Extraction) : null;
    const src = loadSource(input.json);
    sources.set(slug, src);
    const b = body(src, x);
    // The extract's own host labels; our product name ('equipe') is not a source label.
    const forbidden = src.forbiddenLabels.filter((l) => l !== 'equipe');
    const toks = tokens(toDtcg(src.model), forbidden);
    const brandHex = src.brand.light;
    const card: StyleCard = {
      slug, name: entry.name, origin: entry.origin, category: entry.category, tags: entry.tags ?? [],
      brand: { hex: brandHex, hue: brandHex ? round(toOklch(brandHex).h, 1) : null },
      hasDark: src.model.colors.dark !== null,
      fonts: [...new Set([src.model.fonts.sans[0], src.model.fonts.display?.[0], src.model.fonts.mono[0]].filter((f): f is string => !!f))],
      preview: {
        light: Object.fromEntries(PREVIEW_ROLES.map((r) => [r, src.model.colors.light[r]])) as StyleCard['preview']['light'],
        dark: src.model.colors.dark ? (Object.fromEntries(PREVIEW_ROLES.map((r) => [r, src.model.colors.dark![r]])) as StyleCard['preview']['light']) : null,
      },
      releaseId: input.releaseId,
      version: 1,
      updatedAt: PUBLISHED_AT,
    };
    cards.push(card);
    library.push({ slug, ...entry });

    const upload: ReleaseUpload = x
      ? { origin: 'extracted', style: slug, runId: input.runId!, ranOn: 'mac-mini', extract: x as unknown as Record<string, unknown>, reportMd: `# ${x.run.id}\n\nFixture report.\n`, body: b, tokens: toks }
      : { origin: 'original', style: slug, body: b, tokens: toks };
    out[`admin/uploads/${slug}.json`] = upload;

    const formats = Object.keys(toks) as TokenFiles['format'][];
    const detail: StyleDetail = {
      style: { ...card, description: entry.description ?? '', descriptionI18n: entry.descriptionI18n ?? {} },
      release: {
        ...b, id: input.releaseId, version: 1, origin: entry.origin, publishedAt: PUBLISHED_AT, formats,
        measured: x ? { engineVersion: ENGINE_VERSION, schemaVersion: x.schemaVersion, finishedAt: x.run.startedAt } : null,
      },
      releases: [{ id: input.releaseId, version: 1, publishedAt: PUBLISHED_AT, changes: null }],
      notice: NOTICE[entry.origin],
    };
    out[`public/styles/${slug}.json`] = detail;
    out[`public/styles/${slug}/releases.json`] = { releases: detail.releases };
    for (const f of formats) {
      out[`public/releases/${input.releaseId}/tokens/${f}.json`] = { releaseId: input.releaseId, format: f, files: toks[f as keyof Formats]! } satisfies TokenFiles;
    }

    // seed.sql: the same data as rows, for PGlite tests (L1).
    const id = i + 1;
    const contentSha = sha(JSON.stringify(upload.tokens) + JSON.stringify(b));
    seed.push(
      `insert into styles (id, slug, name, origin, description, description_i18n, category, tags, brand_hex, brand_hue, has_dark, fonts, preview, updated_at) overriding system value values ` +
        `(${id}, ${q(slug)}, ${q(entry.name)}, ${q(entry.origin)}, ${q(entry.description ?? '')}, ${qj(entry.descriptionI18n ?? {})}, ${q(entry.category)}, ${qa(entry.tags ?? [])}, ${q(card.brand.hex)}, ${card.brand.hue ?? 'null'}, ${card.hasDark}, ${qa(card.fonts)}, ${qj(card.preview)}, ${q(PUBLISHED_AT)});`,
    );
    if (x && entry.source) {
      seed.push(`insert into style_sources (style_id, service_name, homepage, allowed_urls) values (${id}, ${q(entry.source.serviceName)}, ${q(entry.source.homepage)}, ${qa(entry.source.allowedUrls)});`);
      const ex = JSON.stringify(x);
      seed.push(
        `insert into extraction_runs (id, style_id, engine_run_id, started_at, finished_at, engine_version, schema_version, ran_on, outcome, extract, report_md, content_sha256) values ` +
          `(${q(input.runId)}, ${id}, ${q(x.run.id)}, ${q(x.run.startedAt)}, ${q(x.run.startedAt)}, ${q(ENGINE_VERSION)}, ${q(x.schemaVersion)}, 'mac-mini', 'ok', ${q(ex)}::jsonb, ${q((upload as { reportMd: string }).reportMd)}, ${q(sha(ex))});`,
      );
    }
    seed.push(
      `insert into releases (id, style_id, version, origin, run_id, detail, review, content_sha256, published_at) values ` +
        `(${q(input.releaseId)}, ${id}, 1, ${q(entry.origin)}, ${q(input.runId ?? null)}, ${qj(b)}, 'approved', ${q(contentSha)}, ${q(PUBLISHED_AT)});`,
    );
    for (const f of formats) {
      const files = toks[f as keyof Formats]!;
      const text = JSON.stringify(files);
      seed.push(`insert into token_artifacts (release_id, format, files, sha256, bytes) values (${q(input.releaseId)}, ${q(f)}, ${qj(files)}, ${q(sha(text))}, ${Buffer.byteLength(text)});`);
    }
    seed.push(`update styles set current_release = ${q(input.releaseId)} where id = ${id};`);
  });

  out['admin/library.json'] = library;
  const list: StyleList = { styles: [...cards].sort((a, b) => a.name.localeCompare(b.name)), total: cards.length };
  out['public/styles.json'] = list;
  out['public/meta.json'] = {
    apiVersion: '1', schemaVersion: '0.1', engineVersion: ENGINE_VERSION, remixVersion: REMIX_VERSION,
    styles: { total: cards.length, extracted: cards.filter((c) => c.origin === 'extracted').length, original: cards.filter((c) => c.origin === 'original').length },
    lastPublishedAt: PUBLISHED_AT,
  } satisfies Meta;

  // POST /remix example: Hush's shape and type with a teal brand.
  const request = { sources: [{ style: 'hush' }], brand: { color: '#0f766e' }, prefix: 'acme', variants: 2, fontAlt: true, formats: ['css', 'dtcg'] } satisfies RemixRequest;
  const results = remix([sources.get('hush')!], { color: request.brand.color, name: request.prefix }, { variants: request.variants, fontAlt: request.fontAlt });
  const response: RemixResponse = {
    remixVersion: REMIX_VERSION,
    sources: [{ style: 'hush', releaseId: INPUTS[0]!.releaseId }],
    variants: results.map((r, i) => {
      const dtcg = toDtcg(r);
      const files: RemixResponse['variants'][number]['files'] = {};
      for (const f of request.formats) if ((REMIX_FORMATS as readonly string[]).includes(f)) files[f] = emit(dtcg, [f], { prefix: request.prefix, forbidden: r.forbiddenLabels });
      const fonts = ([['sans', r.model.fonts.sans[0]], ['display', r.model.fonts.display?.[0]], ['mono', r.model.fonts.mono[0]]] as const)
        .filter((p): p is readonly ['sans' | 'display' | 'mono', string] => !!p[1])
        .map(([role, family]) => ({ family, role }));
      return { id: `v${i + 1}`, strategy: r.meta.strategy, files, contrastFails: r.contrast.fails.length, fonts };
    }),
    notice: NOTICE.original,
  };
  out['public/remix.request.json'] = request;
  out['public/remix.response.json'] = response;
  seed.push(`select setval(pg_get_serial_sequence('styles', 'id'), (select max(id) from styles));`);
  out['seed.sql'] = `-- Generated by packages/api-contract/test/build-fixtures.ts. Apply after migrations/0001_init.sql and 0002_localized_text.sql.\n${seed.join('\n')}\n`;
  return out;
}

export function serialize(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const d of ['admin', 'public']) rmSync(join(FIXTURES_DIR, d), { recursive: true, force: true });
  for (const [p, v] of Object.entries(buildFixtures())) {
    const file = join(FIXTURES_DIR, p);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialize(v));
  }
  process.stdout.write(`fixtures written to ${FIXTURES_DIR}\n`);
}
