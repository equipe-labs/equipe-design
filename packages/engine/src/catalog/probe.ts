// In-page probe for the component catalog. The sweep (capture/inpage.ts) holds styles; this
// holds what the catalog needs to recognise a component and tell its states apart: a few
// attributes, class-name words from a fixed vocabulary, and whether an icon/image sits inside.
//
// Same rules as the sweep: values only. Text, URLs, ids and class names never leave the page;
// attribute values leave only when they are short enum-like tokens (`true`, `open`, `outline`).
// `probe` is serialised by Playwright, so it must stay self-contained.

export interface ProbeNode {
  /** Same nth-child path as SweepElement.path: the join key. */
  path: string;
  /** `data-slot` value (shadcn/ui v4 marks parts with it). */
  slot?: string;
  /** Whitelisted attributes with enum-like values; presence-only ones carry `true`. */
  attrs?: Record<string, string>;
  /** Words from HINT_WORDS found in the class names. */
  hints?: string[];
  inputType?: string;
  /** Has an <svg> within two levels. */
  svg?: boolean;
  /** Has an <img> within two levels. */
  img?: boolean;
  /** Is a <label> or has an aria-label (the text is not read). */
  labelled?: boolean;
}

export const HINT_WORDS = [
  'skeleton', 'pulse', 'spin', 'badge', 'chip', 'pill', 'avatar', 'toast', 'sonner', 'kbd', 'tooltip', 'progress', 'spinner',
  'carousel', 'calendar', 'chart', 'sidebar', 'cmdk', 'command', 'card', 'alert', 'breadcrumb', 'pagination', 'separator', 'otp',
  'resizable', 'scroll', 'accordion', 'tabs', 'switch', 'toggle', 'slider', 'drawer', 'sheet', 'popover', 'dialog', 'menu',
  'select', 'combobox', 'table', 'textarea', 'label', 'empty', 'item', 'field', 'form', 'group', 'recharts', 'rdp',
];

/** Attributes whose short enum-like value is reported. */
export const VALUE_ATTRS = [
  'aria-expanded', 'aria-checked', 'aria-selected', 'aria-pressed', 'aria-current', 'aria-modal', 'aria-haspopup', 'aria-orientation',
  'aria-disabled', 'aria-readonly', 'aria-invalid', 'aria-busy', 'aria-roledescription', 'aria-live', 'aria-multiselectable',
  'data-state', 'data-variant', 'data-size', 'data-orientation', 'data-side', 'data-disabled', 'data-invalid', 'data-active', 'data-selected',
  'dir', 'data-sidebar',
];
/** Attributes reported as present (`true`) only. */
export const PRESENCE_ATTRS = [
  'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-activedescendant',
  'disabled', 'required', 'placeholder', 'href', 'open', 'popover', 'contenteditable', 'data-radix-popper-content-wrapper', 'data-sonner-toast',
  'data-vaul-drawer', 'cmdk-root', 'data-input-otp',
];
/** aria-label is matched against these keywords and only the keyword leaves the page. */
export const LABEL_KEYWORDS = ['breadcrumb', 'pagination', 'notifications', 'sidebar', 'calendar', 'main', 'primary', 'carousel', 'slide'];

export function probe(args: { hints: string[]; valueAttrs: string[]; presenceAttrs: string[]; labelKeywords: string[]; max: number }): ProbeNode[] {
  const { hints, valueAttrs, presenceAttrs, labelKeywords, max } = args;
  const out: ProbeNode[] = [];
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
  const hintRe = new RegExp('(?:^|[^a-z])(' + hints.join('|') + ')(?:[^a-z]|$)', 'g');
  const enumLike = /^[\w.:-]{1,24}$/;
  const near = (el: Element, sel: string): boolean => {
    for (const c of Array.from(el.children)) {
      if (c.matches(sel)) return true;
      for (const g of Array.from(c.children)) if (g.matches(sel)) return true;
    }
    return false;
  };
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (out.length >= max) break;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || el.closest('svg') && tag !== 'SVG') continue;
    const node: ProbeNode = { path: pathOf(el) };
    let any = false;
    const slot = el.getAttribute('data-slot');
    if (slot && enumLike.test(slot)) {
      node.slot = slot;
      any = true;
    }
    const attrs: Record<string, string> = {};
    for (const a of valueAttrs) {
      const v = el.getAttribute(a);
      if (v !== null && v !== '' && enumLike.test(v)) attrs[a] = v.toLowerCase();
      else if (v === '' && a.startsWith('data-')) attrs[a] = 'true';
    }
    for (const a of presenceAttrs) if (el.hasAttribute(a)) attrs[a] = 'true';
    if (Object.keys(attrs).length) {
      node.attrs = attrs;
      any = true;
    }
    const lab = el.getAttribute('aria-label');
    if (lab) {
      const low = lab.toLowerCase();
      const kw = labelKeywords.find((k) => low.includes(k));
      if (kw) (node.attrs ??= {})['aria-label'] = kw;
      node.labelled = true;
      any = true;
    }
    if (tag === 'LABEL') {
      node.labelled = true;
      any = true;
    }
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.toLowerCase() : '';
    if (cls) {
      const found = new Set<string>();
      for (const m of cls.matchAll(hintRe)) found.add(m[1]!);
      // Tailwind utility `animate-pulse` / `animate-spin` split by dashes still hit the lookarounds above.
      if (found.size) {
        node.hints = [...found];
        any = true;
      }
    }
    if (tag === 'INPUT') {
      const ty = ((el as HTMLInputElement).type || 'text').toLowerCase();
      if (enumLike.test(ty)) node.inputType = ty;
      any = true;
    }
    if (tag === 'DIALOG' || tag === 'SELECT' || tag === 'TABLE' || tag === 'TEXTAREA' || tag === 'DETAILS' || tag === 'PROGRESS' || tag === 'METER' || tag === 'KBD' || tag === 'HR') any = true;
    if (el.children.length && near(el, 'svg')) {
      node.svg = true;
      any = true;
    } else if (tag === 'SVG') {
      node.svg = true;
      any = true;
    }
    if (el.children.length && near(el, 'img')) {
      node.img = true;
      any = true;
    }
    if (any) out.push(node);
  }
  return out;
}
