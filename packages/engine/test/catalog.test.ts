import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateExtraction } from '@equipe-design/schema';
import { extract, findChrome, report, SHADCN_CATALOG } from '../src/index.ts';
import { HINT_WORDS } from '../src/catalog/probe.ts';
import { STRUCTURES } from '../src/catalog/match.ts';
import { STATE_NAMES } from '../src/catalog/types.ts';

// The reference table (shadcn/ui, snapshot 2026-11-08: the 65 registry:ui entries of
// ui.shadcn.com/r/index.json plus the docs-only data-table, date-picker and typography).
const SHADCN_NAMES = [
  'accordion', 'alert', 'alert-dialog', 'aspect-ratio', 'attachment', 'avatar', 'badge', 'breadcrumb', 'bubble', 'button', 'button-group', 'calendar', 'card', 'carousel', 'chart',
  'checkbox', 'code-block', 'collapsible', 'combobox', 'command', 'context-menu', 'dialog', 'direction', 'drawer', 'dropdown-menu', 'empty', 'field', 'form', 'hover-card', 'input',
  'input-group', 'input-otp', 'item', 'kbd', 'label', 'marker', 'menubar', 'message', 'message-scroller', 'native-select', 'navigation-menu', 'pagination', 'popover', 'progress',
  'questionnaire', 'radio-group', 'resizable', 'scroll-area', 'select', 'separator', 'sheet', 'sidebar', 'skeleton', 'slider', 'sonner', 'spinner', 'switch', 'table', 'tabs',
  'textarea', 'toast', 'toggle', 'toggle-group', 'tooltip', 'trace', 'data-table', 'date-picker', 'typography',
];

describe('reference table', () => {
  it('has every shadcn/ui component once', () => {
    const names = SHADCN_CATALOG.components.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...SHADCN_NAMES].sort());
  });
  it('is well formed: cues, props, states, hints and structures are all known', () => {
    const states = new Set<string>(STATE_NAMES);
    for (const c of SHADCN_CATALOG.components) {
      expect(c.cues.length + (c.structure ? 1 : 0), c.name).toBeGreaterThan(0);
      expect(c.states[0], c.name).toBe('default');
      for (const s of c.states) expect(states.has(s), `${c.name}.${s}`).toBe(true);
      for (const s of Object.keys(c.stateCues ?? {})) expect(c.states, `${c.name} stateCue ${s}`).toContain(s);
      if (c.structure) expect(STRUCTURES[c.structure], `${c.name} structure ${c.structure}`).toBeTypeOf('function');
      for (const cue of [...c.cues, ...(c.parts ?? []).map((p) => p.cue), ...Object.values(c.stateCues ?? {})]) for (const h of cue.hint ?? []) expect(HINT_WORDS, `${c.name} hint ${h}`).toContain(h);
      expect(c.docs).toBe(`https://ui.shadcn.com/docs/components/${c.name}`);
    }
  });
});

const hasChrome = findChrome() !== null;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>t</title><style>
:root{--bg:#fff;--fg:#111;--primary:#2563eb;--border:#e5e7eb;--muted:#f4f4f5}
body{background:var(--bg);color:var(--fg);font:14px/20px system-ui;margin:0;padding:24px}
button{font:inherit;cursor:pointer}
.btn{height:36px;padding:0 16px;border-radius:8px;border:1px solid transparent}
.btn[data-variant=default]{background:var(--primary);color:#fff}
.btn[data-variant=default]:hover{background:#1d4ed8}
.btn[data-variant=outline]{background:#fff;border-color:var(--border);color:var(--fg)}
.btn[data-variant=outline]:hover{background:var(--muted)}
.btn[data-variant=ghost]{background:none;color:var(--fg)}
.btn.sm{height:32px;padding:0 12px}
.btn:disabled{opacity:.5}
.card{border:1px solid var(--border);border-radius:12px;padding:24px;margin:12px;width:260px;display:inline-block;vertical-align:top}
.badge{display:inline-block;border-radius:9999px;background:var(--muted);padding:2px 10px;font-size:12px}
.sw{width:36px;height:20px;border-radius:9999px;border:0;background:#d4d4d8}
.sw[aria-checked=true]{background:var(--primary)}
[role=tab]{padding:6px 12px;border:0;background:none}
[role=tab][aria-selected=true]{background:#fff;box-shadow:0 1px 2px #0003}
[role=tablist]{display:inline-flex;background:var(--muted);padding:3px;border-radius:8px}
[role=alert]{border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin:12px}
input[type=text]{height:36px;border:1px solid var(--border);border-radius:8px;padding:0 12px}
</style></head><body>
<div><button class="btn" data-variant="default" data-slot="button">Save</button>
<button class="btn" data-variant="default" data-slot="button">Send</button>
<button class="btn" data-variant="outline" data-slot="button">Cancel</button>
<button class="btn sm" data-variant="outline" data-slot="button">Small</button>
<button class="btn" data-variant="ghost" data-slot="button">Skip</button>
<button class="btn" data-variant="default" data-slot="button" disabled>Wait</button></div>
<div><span class="badge">New</span> <span class="badge">Beta</span></div>
<div><button class="sw" role="switch" aria-checked="true" data-state="checked"></button>
<button class="sw" role="switch" aria-checked="false" data-state="unchecked"></button>
<button class="sw" role="switch" aria-checked="false" data-state="unchecked"></button></div>
<div role="tablist"><button role="tab" aria-selected="true">One</button><button role="tab" aria-selected="false">Two</button></div>
<div role="alert">Heads up, something happened.</div>
<div><input type="text" placeholder="Name"> <textarea></textarea> <hr></div>
<div><div class="card" data-slot="card"><div data-slot="card-header">Title</div><div data-slot="card-content">Body text</div><div data-slot="card-footer"><button class="btn" data-variant="default">Go</button></div></div>
<div class="card" data-slot="card"><div data-slot="card-header">Title 2</div><div data-slot="card-content">Body</div></div></div>
<div role="progressbar" aria-valuenow="40" style="height:8px;width:200px;background:var(--muted);border-radius:9999px"></div>
</body></html>`;

let server: Server;
let base = '';
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe.skipIf(!hasChrome)('catalog extraction on a shadcn-shaped page', () => {
  it('finds components, splits variants and sizes, reads states, ties values to roles, and passes the schema', async () => {
    const { extraction: x } = await extract([`${base}/`], { widths: [1000], modes: 'light' });
    expect(x.schemaVersion).toBe('0.2');
    const check = validateExtraction(x);
    expect(check.ok ? [] : check.issues).toEqual([]);
    const cat = x.inferred.catalog!;
    expect(cat.reference.count).toBe(SHADCN_NAMES.length);
    expect(cat.coverage).toHaveLength(SHADCN_NAMES.length);
    const found = new Set(cat.components.map((c) => c.name));
    for (const n of ['button', 'badge', 'switch', 'tabs', 'alert', 'input', 'textarea', 'card', 'progress', 'separator']) expect(found, n).toContain(n);
    expect(x.summary.catalog).toEqual({ found: cat.components.length, of: SHADCN_NAMES.length });

    const button = cat.components.find((c) => c.name === 'button')!;
    expect(button.instances).toBe(7);
    expect(button.variants.map((v) => v.dataVariant).sort()).toEqual(['default', 'ghost', 'outline']);
    expect(button.sizes.map((s) => s.height.value)).toEqual([32, 36]);
    const primary = button.variants.find((v) => v.dataVariant === 'default')!;
    expect(primary.suggestedName).toBe('primary');
    const bg = primary.props.find((p) => p.prop === 'background')!;
    expect(x.observed.color.find((c) => c.id === bg.color)!.value.hex).toBe('#2563eb');
    expect(primary.props.find((p) => p.prop === 'radius')).toMatchObject({ length: { value: 8, unit: 'px' } });
    // Hover is read by forcing :hover; disabled from the page's own disabled button.
    expect(primary.states.find((s) => s.name === 'hover')).toMatchObject({ observed: true, method: 'forcePseudoState' });
    expect(primary.states.find((s) => s.name === 'hover')!.diff!['background-color']).toMatch(/^c\d+ -> c\d+$/);
    expect(primary.states.find((s) => s.name === 'disabled')).toMatchObject({ observed: true, method: 'on-page-example' });
    expect(primary.states.find((s) => s.name === 'disabled')!.diff!['opacity']).toBe('1 -> 0.5');
    expect(primary.structure.label).toEqual({ present: true, position: 'center' });

    // Checked and unchecked switches are one look with a state, not two variants.
    const sw = cat.components.find((c) => c.name === 'switch')!;
    expect(sw.instances).toBe(3);
    expect(sw.variants).toHaveLength(1);
    expect(sw.variants[0]!.states.find((s) => s.name === 'checked')).toMatchObject({ observed: true, method: 'on-page-example' });

    // Card parts come from data-slot.
    const card = cat.components.find((c) => c.name === 'card')!;
    expect(card.instances).toBe(2);
    expect(card.parts.filter((p) => p.present).map((p) => p.name)).toEqual(expect.arrayContaining(['header', 'content']));

    // Not found rows say why; the report has the found/not-found table.
    const missing = cat.coverage.find((c) => c.name === 'accordion')!;
    expect(missing).toMatchObject({ found: false, component: null });
    expect(missing.note).toBeTruthy();
    expect(x.limits.some((l) => l.kind === 'component-not-found')).toBe(true);
    const md = report(x);
    expect(md).toContain('기준표(shadcn/ui, 2026-11-08) 대비 컴포넌트');
    expect(md).toMatch(/\| button \| ✓ \| 7 \|/);
    expect(md).toMatch(/\| accordion \| · \|/);
  }, 120_000);
});
