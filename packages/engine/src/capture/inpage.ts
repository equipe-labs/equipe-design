// Code that runs inside the page. `install` is serialised by Playwright and must stay
// self-contained: no imports, no references to module scope. It puts one object on
// `window.__eqd`; the Node side calls its methods with `callInPage`.
//
// What leaves the page is values only: normalised colours as numbers, lengths in px,
// short DOM paths we build ourselves, rule conditions and selectors (truncated). Page
// text, image URLs and CSS rule bodies never leave it (README 3장).

/** [r, g, b, a] — r, g, b in 0..255 (floats allowed), a in 0..1. */
export type Rgba = [number, number, number, number];

export interface SweepElement {
  /** nth-child path, used only to pair the same element across sweeps. Never stored. */
  path: string;
  /** Short selector: tag + up to 2 classes (120 chars max). */
  sel: string;
  tag: string;
  role: string | null;
  /** Index of the top-level section (landmark/section) the element sits in. */
  sec: number;
  rect: [number, number, number, number];
  /** Has its own non-blank text node (the text itself is not read out). */
  text: boolean;
  /** Inside <svg>, or aria-hidden, or presentational. */
  decor: boolean;
  /** Inside the home link at the top of the page (usually the logo). */
  home: boolean;
  /** Itself or a close ancestor is a button, link, tab, input… */
  interactive: string | null;
  disabled: boolean;
  /** Inside a cookie/consent banner. */
  banner: boolean;
  /** Indexes into SweepResult.colors. -1 = none/transparent. */
  bg: number;
  fg: number;
  border: [number, number, number, number];
  outline: number;
  fill: number;
  stroke: number;
  borderWidth: [number, number, number, number];
  radius: [number, number, number, number];
  padding: [number, number, number, number];
  margin: [number, number, number, number];
  gap: [number, number];
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** px, or null for `normal`. */
  lineHeight: number | null;
  letterSpacing: number;
  shadow: string;
  transition: { property: string; duration: string; easing: string };
  zIndex: number | null;
  position: string;
  opacity: number;
  /** Raw font-size declaration hints: clamp/vw seen in inline style or not. */
  childCount: number;
  /** Hash of the child tag structure (2 levels), for repeated-structure detection. */
  shape: string;
}

export interface SweepResult {
  colors: Rgba[];
  elements: SweepElement[];
  sections: number;
  doc: { width: number; height: number };
  themeColor: Rgba | null;
}

export interface SheetScan {
  readable: number;
  unreadable: string[];
  declarations: { name: string; selector: string; condition: string | null }[];
  /** var name -> selectors whose declarations use it (deduplicated, capped). */
  usage: Record<string, string[]>;
  darkMediaRules: number;
  darkSelectors: Record<string, number>;
  breakpoints: { query: string; px: number; rules: number }[];
  hasClamp: boolean;
}

export interface VarValue {
  raw: string;
  color: Rgba | null;
  px: number | null;
}

export interface StateProps {
  bg: Rgba | null;
  fg: Rgba | null;
  border: Rgba | null;
  outline: Rgba | null;
  outlineWidth: number;
  shadow: string;
  opacity: number;
  textDecoration: string;
  transform: string;
}

export function install(): void {
  const w = window as unknown as { __eqd?: unknown };
  if (w.__eqd) return;

  const SKIP_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'TITLE', 'BASE']);
  const SECTION_TAGS = new Set(['SECTION', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'ARTICLE']);
  const LANDMARK_ROLES = new Set(['banner', 'contentinfo', 'navigation', 'region', 'complementary']);
  const INTERACTIVE = new Set(['button', 'link', 'tab', 'checkbox', 'switch', 'menuitem', 'textbox', 'combobox', 'option', 'radio', 'searchbox', 'slider']);
  const BANNER_RE = /cookie|consent|gdpr|onetrust|cookiebot|cc-window|cc-banner|truste|didomi|usercentrics/i;

  // ---- colours -------------------------------------------------------------------
  const cache = new Map<string, [number, number, number, number] | null>();
  let canvasCtx: CanvasRenderingContext2D | null = null;
  const parseColor = (s: string): [number, number, number, number] | null => {
    if (!s || s === 'transparent' || s === 'none' || s === 'currentcolor') return null;
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    let out: [number, number, number, number] | null = null;
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
    const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
    const alphaOf = (a: string | undefined) => (a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a));
    if (m) {
      out = [+m[1]!, +m[2]!, +m[3]!, alphaOf(m[4])];
    } else if (srgb) {
      out = [+srgb[1]! * 255, +srgb[2]! * 255, +srgb[3]! * 255, alphaOf(srgb[4])];
    } else {
      // oklch(), lab(), color(display-p3 …), color-mix(…): let the browser convert to sRGB.
      const am = /\/\s*([\d.]+%?)\s*\)\s*$/.exec(s);
      const alpha = am ? alphaOf(am[1]) : 1;
      const opaque = am ? s.replace(/\/\s*[\d.]+%?\s*\)\s*$/, ')') : s;
      if (!canvasCtx) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 1;
        canvasCtx = cv.getContext('2d', { willReadFrequently: true });
      }
      if (canvasCtx) {
        canvasCtx.clearRect(0, 0, 1, 1);
        canvasCtx.fillStyle = '#000';
        canvasCtx.fillStyle = opaque;
        canvasCtx.fillRect(0, 0, 1, 1);
        const d = canvasCtx.getImageData(0, 0, 1, 1).data;
        out = [d[0]!, d[1]!, d[2]!, alpha];
      }
    }
    if (out && out[3] <= 0) out = null;
    cache.set(s, out);
    return out;
  };

  let table: [number, number, number, number][] = [];
  let tableIndex = new Map<string, number>();
  const colorIdx = (s: string): number => {
    const c = parseColor(s);
    if (!c) return -1;
    const k = c.map((v) => Math.round(v * 1000) / 1000).join(',');
    let i = tableIndex.get(k);
    if (i === undefined) {
      i = table.length;
      table.push(c);
      tableIndex.set(k, i);
    }
    return i;
  };

  // ---- DOM helpers ---------------------------------------------------------------
  const px = (s: string): number => {
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : 0;
  };
  const shortSel = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter((c) => c && /^[A-Za-z_-][\w-]*$/.test(c)).slice(0, 2) : [];
    return (tag + cls.map((c) => '.' + c).join('')).slice(0, 120);
  };
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let e: Element | null = el;
    while (e && e !== document.documentElement) {
      const p: Element | null = e.parentElement;
      if (!p) break;
      parts.push(String(Array.prototype.indexOf.call(p.children, e)));
      e = p;
    }
    return parts.reverse().join('/');
  };
  const elementAt = (path: string): Element | null => {
    let e: Element | null = document.documentElement;
    if (!path) return e;
    for (const part of path.split('/')) {
      e = e ? e.children[+part] ?? null : null;
    }
    return e;
  };
  const roleOf = (el: Element): string | null => {
    const r = el.getAttribute('role');
    if (r) return r.split(/\s+/)[0]!;
    const t = el.tagName;
    if (t === 'A' || t === 'AREA') return el.hasAttribute('href') ? 'link' : null;
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button';
    if (t === 'INPUT') {
      const ty = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(ty)) return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'range') return 'slider';
      if (ty === 'hidden') return null;
      if (ty === 'search') return 'searchbox';
      return 'textbox';
    }
    if (t === 'TEXTAREA') return 'textbox';
    if (t === 'SELECT') return 'combobox';
    if (t === 'DIALOG') return 'dialog';
    if (/^H[1-6]$/.test(t)) return 'heading';
    if (t === 'NAV') return 'navigation';
    if (t === 'IMG') return 'img';
    return null;
  };
  const hasOwnText = (el: Element): boolean => {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return false;
  };

  // ---- sweep ---------------------------------------------------------------------
  const sweep = (): SweepResult => {
    table = [];
    tableIndex = new Map();
    const body = document.body;
    const doc = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
    const sectionIndex = new Map<Element, number>();
    const all: Element[] = [document.documentElement, ...(body ? [body, ...body.querySelectorAll('*')] : [])];
    const elements: SweepElement[] = [];
    // Section = outermost landmark/section ancestor that is not most of the page. Pages
    // wrapped in one big container fall back to a vertical band of the page instead.
    const docH = Math.max(1, doc.height);
    const bigCache = new Map<Element, boolean>();
    const isBig = (e: Element) => {
      let v = bigCache.get(e);
      if (v === undefined) bigCache.set(e, (v = e.getBoundingClientRect().height > docH * 0.5));
      return v;
    };
    const sectionOf = (el: Element, y: number): number => {
      let top: Element | null = null;
      for (let e: Element | null = el; e && e !== body && e !== document.documentElement; e = e.parentElement) {
        const r = e.getAttribute('role');
        if ((SECTION_TAGS.has(e.tagName) || (r && LANDMARK_ROLES.has(r))) && !isBig(e)) top = e;
      }
      if (!top) return 1000 + Math.floor(Math.max(0, y) / 900);
      let i = sectionIndex.get(top);
      if (i === undefined) {
        i = sectionIndex.size + 1;
        sectionIndex.set(top, i);
      }
      return i;
    };
    // The home link at the top (usually the logo).
    const home = Array.from(document.querySelectorAll('a[href]')).find((a) => {
      try {
        const u = new URL((a as HTMLAnchorElement).href);
        if (u.origin !== location.origin || (u.pathname !== '/' && u.pathname !== '') || u.hash) return false;
        // display:contents links have no box of their own; look at what they hold.
        const boxes = [a, ...Array.from(a.querySelectorAll('*')).slice(0, 20)].map((e) => e.getBoundingClientRect());
        return boxes.some((r) => r.width > 0 && r.top + window.scrollY < 200);
      } catch {
        return false;
      }
    }) ?? null;
    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest('head, script, style, noscript, template')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const x = r.left + window.scrollX;
      const y = r.top + window.scrollY;
      if (x + r.width <= 0 || y + r.height <= 0 || x >= doc.width + 50) continue;
      const svg = el.closest('svg') !== null;
      const decor = svg || el.closest('[aria-hidden="true"], [role="presentation"]') !== null;
      let interactive: string | null = null;
      for (let e: Element | null = el, d = 0; e && d < (svg ? 8 : 3); e = e.parentElement, d++) {
        const ro = roleOf(e);
        if (ro && INTERACTIVE.has(ro)) {
          interactive = ro;
          break;
        }
      }
      let banner = false;
      for (let e: Element | null = el; e && e !== body; e = e.parentElement) {
        if (BANNER_RE.test(e.id) || (typeof e.className === 'string' && BANNER_RE.test(e.className))) {
          banner = true;
          break;
        }
      }
      const bw: [number, number, number, number] = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
      const bs = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
      const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
      const border = [0, 1, 2, 3].map((i) => (bw[i]! > 0 && bs[i] !== 'none' && bs[i] !== 'hidden' ? colorIdx(bc[i]!) : -1)) as [number, number, number, number];
      const radiusOne = (v: string): number => {
        const first = v.split(' ')[0] ?? '0';
        if (first.endsWith('%')) return (Math.min(r.width, r.height) * parseFloat(first)) / 100;
        return px(first);
      };
      const lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
      const role = roleOf(el);
      const kids = el.children;
      let shape = '';
      for (let i = 0; i < kids.length && i < 8; i++) {
        const k = kids[i]!;
        shape += k.tagName + '(' + Array.prototype.map.call(k.children, (g: Element) => g.tagName).slice(0, 6).join(',') + ')';
      }
      elements.push({
        path: pathOf(el),
        sel: shortSel(el),
        tag: el.tagName.toLowerCase(),
        role,
        sec: sectionOf(el, y),
        home: home !== null && home.contains(el),
        rect: [Math.round(x), Math.round(y), Math.round(r.width), Math.round(r.height)],
        text: hasOwnText(el),
        decor,
        interactive,
        disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
        banner,
        bg: colorIdx(cs.backgroundColor),
        fg: colorIdx(cs.color),
        border,
        outline: cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0 ? colorIdx(cs.outlineColor) : -1,
        fill: svg && cs.fill && !cs.fill.startsWith('url') ? colorIdx(cs.fill) : -1,
        stroke: svg && cs.stroke && cs.stroke !== 'none' && !cs.stroke.startsWith('url') ? colorIdx(cs.stroke) : -1,
        borderWidth: bw,
        radius: [radiusOne(cs.borderTopLeftRadius), radiusOne(cs.borderTopRightRadius), radiusOne(cs.borderBottomRightRadius), radiusOne(cs.borderBottomLeftRadius)],
        padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
        margin: [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)],
        gap: cs.display.includes('flex') || cs.display.includes('grid') ? [px(cs.rowGap), px(cs.columnGap)] : [0, 0],
        fontFamily: cs.fontFamily,
        fontSize: px(cs.fontSize),
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        lineHeight: lh,
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
        shadow: cs.boxShadow,
        transition: { property: cs.transitionProperty, duration: cs.transitionDuration, easing: cs.transitionTimingFunction },
        zIndex: cs.zIndex === 'auto' ? null : parseInt(cs.zIndex, 10),
        position: cs.position,
        opacity: parseFloat(cs.opacity),
        childCount: kids.length,
        shape,
      });
    }
    const meta = document.querySelector('meta[name="theme-color"]:not([media]), meta[name="theme-color"]');
    const themeColor = meta ? parseColor(normaliseColor(meta.getAttribute('content') ?? '')) : null;
    const sections = new Set(elements.map((e) => e.sec)).size;
    return { colors: table, elements, sections, doc, themeColor };
  };

  // Resolves any CSS colour string through the browser into its computed form.
  const probe = (): HTMLElement => {
    let p = document.getElementById('__eqd_probe');
    if (!p) {
      p = document.createElement('div');
      p.id = '__eqd_probe';
      p.setAttribute('aria-hidden', 'true');
      p.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
      (document.body ?? document.documentElement).appendChild(p);
    }
    return p;
  };
  const normaliseColor = (s: string): string => {
    if (!s || !CSS.supports('color', s)) return '';
    const p = probe();
    p.style.color = '';
    p.style.color = s;
    const out = getComputedStyle(p).color;
    p.style.color = '';
    return out;
  };

  // ---- stylesheets ---------------------------------------------------------------
  const DARK_SELECTORS: [string, RegExp][] = [
    ['class:dark', /(^|[\s,(>~+])(html|:root|body)?\.dark(?![\w-])/],
    ['class:theme-dark', /\.theme-dark(?![\w-])/],
    ['class:dark-theme', /\.dark-theme(?![\w-])/],
    ['data-theme', /\[data-theme=["']?dark["']?\]/],
    ['data-mode', /\[data-mode=["']?dark["']?\]/],
    ['data-color-mode', /\[data-color-mode=["']?dark["']?\]/],
    ['data-color-scheme', /\[data-color-scheme=["']?dark["']?\]/],
    ['data-bs-theme', /\[data-bs-theme=["']?dark["']?\]/],
  ];
  const scanRules = (rules: CSSRuleList, conds: string[], out: SheetScan) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet) scanRules(rule.styleSheet.cssRules, conds, out);
        } catch {
          /* cross-origin import */
        }
        continue;
      }
      if (rule instanceof CSSMediaRule) {
        const cond = '@media ' + rule.conditionText;
        if (/prefers-color-scheme:\s*dark/.test(rule.conditionText)) out.darkMediaRules += rule.cssRules.length;
        const bp = /\((?:max|min)-width:\s*([\d.]+)(px|em|rem)\)/.exec(rule.conditionText);
        if (bp) {
          const v = parseFloat(bp[1]!) * (bp[2] === 'px' ? 1 : 16);
          const q = rule.conditionText.slice(0, 120);
          const prev = out.breakpoints.find((b) => b.query === q);
          if (prev) prev.rules += rule.cssRules.length;
          else out.breakpoints.push({ query: q, px: v, rules: rule.cssRules.length });
        }
        scanRules(rule.cssRules, [...conds, cond], out);
        continue;
      }
      if (rule instanceof CSSSupportsRule) {
        scanRules(rule.cssRules, [...conds, '@supports ' + rule.conditionText], out);
        continue;
      }
      if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        scanRules(rule.cssRules, conds, out);
        continue;
      }
      if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) {
        scanRules(rule.cssRules, [...conds, '@container ' + rule.conditionText], out);
        continue;
      }
      if (rule instanceof CSSStyleRule) {
        const sel = rule.selectorText;
        for (const [name, re] of DARK_SELECTORS) if (re.test(sel)) out.darkSelectors[name] = (out.darkSelectors[name] ?? 0) + 1;
        const st = rule.style;
        for (let i = 0; i < st.length; i++) {
          const prop = st[i]!;
          const val = st.getPropertyValue(prop);
          if (prop.startsWith('--')) {
            out.declarations.push({ name: prop, selector: sel.slice(0, 120), condition: conds.length ? conds.join(' ') : null });
          }
          if (val.includes('clamp(') && prop === 'font-size') out.hasClamp = true;
          if (val.includes('var(--')) {
            for (const m of val.matchAll(/var\(\s*(--[\w-]+)/g)) {
              const list = (out.usage[m[1]!] ??= []);
              if (list.length < 40 && !list.includes(sel)) list.push(sel);
            }
          }
        }
        if (rule.cssRules && rule.cssRules.length) scanRules(rule.cssRules, conds, out);
      }
    }
  };
  const emptyScan = (): SheetScan => ({ readable: 0, unreadable: [], declarations: [], usage: {}, darkMediaRules: 0, darkSelectors: {}, breakpoints: [], hasClamp: false });
  const scanSheets = (): SheetScan => {
    const out = emptyScan();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        rules = null;
      }
      if (!rules) {
        if (sheet.href) out.unreadable.push(sheet.href);
        continue;
      }
      out.readable++;
      scanRules(rules, sheet.media && sheet.media.mediaText ? ['@media ' + sheet.media.mediaText] : [], out);
    }
    for (const sheet of document.adoptedStyleSheets ?? []) {
      out.readable++;
      scanRules(sheet.cssRules, [], out);
    }
    return out;
  };
  // A cross-origin sheet's text, fetched by Node from the response the page already got.
  // Parsed here and dropped; only the scan leaves.
  const scanText = (text: string): SheetScan => {
    const out = emptyScan();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    out.readable = 1;
    scanRules(sheet.cssRules, [], out);
    return out;
  };

  // ---- variables -----------------------------------------------------------------
  const stripPseudoElements = (sel: string) => sel.replace(/::?(before|after|placeholder|selection|marker|backdrop|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)(\([^)]*\))?/g, '');
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const resolveVars = (arg: { names: string[]; scopes: Record<string, string[]> }): Record<string, VarValue> => {
    const out: Record<string, VarValue> = {};
    const root = document.documentElement;
    const rootCs = getComputedStyle(root);
    const p = probe();
    for (const name of arg.names) {
      let raw = rootCs.getPropertyValue(name).trim();
      let host: Element = root;
      if (!raw) {
        for (const sel of arg.scopes[name] ?? []) {
          let el: Element | null = null;
          try {
            el = document.querySelector(stripPseudoElements(sel));
          } catch {
            el = null;
          }
          if (el) {
            const v = getComputedStyle(el).getPropertyValue(name).trim();
            if (v) {
              raw = v;
              host = el;
              break;
            }
          }
        }
      }
      if (!raw) continue;
      let color: [number, number, number, number] | null = null;
      let len: number | null = null;
      if (CSS.supports('color', raw) && !/^(inherit|initial|unset|revert|currentcolor)$/i.test(raw)) {
        color = parseColor(normaliseColor(raw));
        if (!color && /transparent|#0{3,4}\b|#0{8}\b/.test(raw)) color = null;
      } else if (/^-?[\d.]+(px|rem|em)$/.test(raw) || /^calc\(/.test(raw)) {
        if (host === root) {
          p.style.paddingLeft = '';
          p.style.paddingLeft = raw;
          const v = parseFloat(getComputedStyle(p).paddingLeft);
          p.style.paddingLeft = '';
          if (Number.isFinite(v)) len = v;
        }
      } else if (raw === '0') {
        len = 0;
      }
      out[name] = { raw: raw.slice(0, 200), color, px: len };
    }
    return out;
  };
  const countUsage = (usage: Record<string, string[]>): Record<string, number> => {
    const out: Record<string, number> = {};
    const memo = new Map<string, Element[]>();
    for (const [name, sels] of Object.entries(usage)) {
      const set = new Set<Element>();
      for (const sel of sels) {
        let els = memo.get(sel);
        if (!els) {
          try {
            els = Array.from(document.querySelectorAll(stripPseudoElements(sel) || '*:not(*)')).filter(visible);
          } catch {
            els = [];
          }
          memo.set(sel, els);
        }
        for (const e of els) set.add(e);
        if (set.size > 5000) break;
      }
      out[name] = set.size;
    }
    return out;
  };

  // ---- modes ---------------------------------------------------------------------
  const applyToggle = (kind: string): boolean => {
    const html = document.documentElement;
    const before = getComputedStyle(document.body ?? html).backgroundColor + getComputedStyle(document.body ?? html).color;
    if (kind.startsWith('class:')) {
      const cls = kind.slice(6);
      html.classList.remove('light', 'theme-light', 'light-theme');
      html.classList.add(cls);
      if (document.body) document.body.classList.add(cls);
    } else {
      html.setAttribute(kind, 'dark');
    }
    html.style.colorScheme = 'dark';
    const after = getComputedStyle(document.body ?? html).backgroundColor + getComputedStyle(document.body ?? html).color;
    return before !== after;
  };

  // ---- states --------------------------------------------------------------------
  const targets: Element[] = [];
  const markTargets = (paths: string[]): number[] => {
    targets.length = 0;
    return paths.map((p) => {
      const el = elementAt(p);
      if (!el) return -1;
      targets.push(el);
      return targets.length - 1;
    });
  };
  const readState = (i: number): StateProps | null => {
    const el = targets[i];
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      bg: parseColor(cs.backgroundColor),
      fg: parseColor(cs.color),
      border: px(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? parseColor(cs.borderTopColor) : null,
      outline: cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0 ? parseColor(cs.outlineColor) : null,
      outlineWidth: cs.outlineStyle !== 'none' ? px(cs.outlineWidth) : 0,
      shadow: cs.boxShadow,
      opacity: parseFloat(cs.opacity),
      textDecoration: cs.textDecorationLine,
      transform: cs.transform,
    };
  };

  // ---- page checks ---------------------------------------------------------------
  const pageCheck = () => {
    const pw = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible).length;
    const textLen = (document.body?.innerText ?? '').trim().length;
    const challenge =
      document.querySelector('#challenge-form, #cf-challenge-running, #challenge-running, .cf-turnstile, #px-captcha, .g-recaptcha, .h-captcha, iframe[src*="captcha"], iframe[src*="challenges.cloudflare.com"]') !== null ||
      /^(just a moment|attention required|access denied|are you a robot|verify you are human)/i.test(document.title.trim());
    const forms = document.querySelectorAll('form').length;
    // Only counts, never the text itself.
    return { passwordFields: pw, textLength: textLen, challenge, forms, elements: document.querySelectorAll('body *').length };
  };

  const scroll = async () => {
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    const limit = 40;
    for (let i = 0; i < limit; i++) {
      const before = window.scrollY;
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 120));
      if (window.scrollY === before || window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) break;
    }
    await new Promise((r) => setTimeout(r, 200));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 100));
  };

  w.__eqd = { sweep, scanSheets, scanText, resolveVars, countUsage, applyToggle, markTargets, readState, pageCheck, scroll };
}
