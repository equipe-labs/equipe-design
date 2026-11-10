#!/usr/bin/env node
// Comparison sheets for inferred.catalog: original crop vs redraw from extracted values vs state strip.
// Usage: node scripts/component-sheets.mjs <extract.json> <outDir> [--only a,b] [--max-variants 6]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchBrowser } from '../packages/engine/src/capture/page.ts';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (pos.length < 2) { console.error('usage: component-sheets.mjs <extract.json> <outDir> [--only a,b] [--max-variants 6]'); process.exit(0); }
const [file, outDir] = pos;
const only = flag('--only', '') ? flag('--only').split(',') : null;
const maxVariants = Number(flag('--max-variants', 6));

const ex = JSON.parse(readFileSync(file, 'utf8'));
const colors = new Map((ex.observed?.color ?? []).map((c) => [c.id, c.value]));
const styles = new Map((ex.observed?.typography?.styles ?? []).map((s) => [s.id, s]));
const roles = ex.inferred?.roles ?? [];
const roleColor = (name) => colors.get(roles.find((r) => r.role === name)?.light ?? roles.find((r) => r.role === name)?.dark);
const pageBg = css(roleColor('background')) ?? '#fff';
const ringColor = css(roleColor('ring')) ?? css(roleColor('primary')) ?? '#888';
const pages = ex.source?.pages ?? [];
const comps = (ex.inferred?.catalog?.components ?? []).filter((c) => !only || only.includes(c.name));

function css(v) {
  if (!v) return null;
  if (v.alpha === undefined || v.alpha >= 1) return v.hex;
  const h = v.hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${v.alpha})`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const px = (l) => (l ? `${l.value}${l.unit === 'px' ? 'px' : l.unit}` : null);
const prop = (v, name) => v.props.find((p) => p.prop === name);

// Redraw a variant from props only; `diff` (state) overrides some properties.
function redraw(v, comp, diff = {}) {
  const get = (n) => prop(v, n);
  const col = (n) => css(colors.get(get(n)?.color));
  const resolve = (s) => { const id = String(s).split('->').pop().trim(); return id === 'none' ? null : css(colors.get(id)); };
  let bg = col('background'), fg = col('color'), bc = col('border'), opacity = 1, ring = false, outline = null;
  if ('background-color' in diff) bg = resolve(diff['background-color']);
  if ('color' in diff) fg = resolve(diff.color) ?? fg;
  if ('border-color' in diff) bc = resolve(diff['border-color']);
  if ('opacity' in diff) opacity = Number(String(diff.opacity).split('->').pop());
  if (/-> shadow/.test(diff['box-shadow'] ?? '')) ring = true;
  if (diff.outline && diff.outline !== 'changed') outline = `1px solid ${resolve(diff.outline.replace(/^.*?(c\d+)$/, '$1')) ?? ringColor}`;
  const bw = get('borderWidth')?.length?.value ?? 0;
  const ts = styles.get(get('typeStyle')?.typeStyle);
  const ev = (v.evidence ?? [])[0];
  const w = get('width')?.length ? px(get('width').length) : ev ? `${ev.rect[2]}px` : 'auto';
  const h = get('height')?.length ? px(get('height').length) : 'auto';
  const shadows = (get('shadow')?.shadow ?? []).filter((s) => s.color?.alpha > 0 || s.blur || s.spread)
    .map((s) => `${s.inset ? 'inset ' : ''}${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px ${css(s.color)}`);
  if (ring) shadows.push(`0 0 0 2px ${ringColor}`);
  const icon = v.structure?.icon?.present ? '<i style="display:block;width:14px;height:14px;background:currentColor;opacity:.6;border-radius:2px"></i>' : '';
  const label = v.structure?.label?.present === false ? '' : '<span>Aa</span>';
  const maxH = Math.min(parseFloat(h) || 0, 300);
  const st = [
    'box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;flex:none;overflow:hidden',
    `width:${w}`, h !== 'auto' ? `height:${maxH}px` : '', `max-width:420px`,
    bg ? `background:${bg}` : '', fg ? `color:${fg}` : '',
    bw && bc ? `border:${bw}px solid ${bc}` : '',
    get('radius') ? `border-radius:${px(get('radius').length)}` : '',
    `padding:${px(get('paddingY')?.length) ?? '0'} ${px(get('paddingX')?.length) ?? '0'}`,
    get('gap') ? `gap:${px(get('gap').length)}` : '',
    shadows.length ? `box-shadow:${shadows.join(',')}` : '',
    outline ? `outline:${outline}` : '', `opacity:${opacity}`,
    ts ? `font:${ts.weight} ${px(ts.size)}/1.2 '${ts.family}',system-ui,sans-serif` : '',
  ].filter(Boolean).join(';');
  return `<div style="${st}">${icon}${label}</div>`;
}

function roleLabels(v) {
  return v.props.filter((p) => p.role && ['background', 'color', 'border'].includes(p.prop)).map((p) => `${p.prop}→${p.role}`).join(', ');
}

// Original crops, cached per page+width screenshot (page opened once per width).
const shots = new Map();
let lastLoad = 0;
async function pageShot(browser, pi, width) {
  const key = `${pi}@${width}`;
  if (shots.has(key)) return shots.get(key);
  const wait = 1000 - (Date.now() - lastLoad);
  if (wait > 0) await sleep(wait);
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  let entry = null;
  try {
    await page.goto(pages[pi].url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    entry = { page, ctx };
  } catch (e) { await ctx.close(); entry = { error: e.message }; }
  lastLoad = Date.now();
  shots.set(key, entry);
  return entry;
}
async function crop(browser, evs) {
  for (let i = 0; i < Math.min(evs.length, 6); i++) {
    const e = evs[i];
    const [x, y, w, h] = e.rect;
    if (!pages[e.page] || w <= 0 || h <= 0 || w + 16 > 900 || h + 16 > 600 || x < 8 || y < 8) continue;
    const s = await pageShot(browser, e.page, e.width);
    if (!s.page) continue;
    try {
      const buf = await s.page.screenshot({ fullPage: true, clip: { x: x - 8, y: y - 8, width: w + 16, height: h + 16 } });
      return { src: `data:image/png;base64,${buf.toString('base64')}`, note: i ? `evidence #${i + 1} (earlier samples failed)` : '' };
    } catch { /* try next sample */ }
  }
  return null;
}

const STATES = ['hover', 'focus-visible', 'active', 'disabled'];
function stateStrip(v, comp) {
  const chips = STATES.map((n) => {
    const s = (v.states ?? []).find((x) => x.name === n);
    if (!s?.observed || !s.diff) return `<div class="chip off"><div class="ph">not observed</div><b>${n}</b></div>`;
    const changedOnly = Object.values(s.diff).every((d) => d === 'changed');
    return `<div class="chip"><div class="stage">${redraw(v, comp, changedOnly ? {} : s.diff)}</div><b>${n}</b>${changedOnly ? '<small>changed (no values)</small>' : ''}</div>`;
  });
  return chips.join('');
}

const CSS = `body{margin:0;padding:12px;background:#f4f4f5;font:12px system-ui,sans-serif;color:#222;width:max-content}
h2{margin:0 0 8px;font-size:15px}table{border-collapse:collapse}th,td{border:1px solid #d4d4d8;padding:8px;vertical-align:top;background:#fff}
th{background:#eee;text-align:left}.stage{padding:8px;background:${pageBg};display:inline-block;min-width:60px}
.cap{font-size:11px;margin-bottom:6px;max-width:220px}.cap small{color:#666}.strip{display:flex;gap:8px;flex-wrap:wrap;max-width:560px}
.chip{display:flex;flex-direction:column;gap:3px;align-items:flex-start}.chip b{font-size:10px;color:#555}.chip small{font-size:9px;color:#a60}
.chip.off{opacity:.55}.ph{background:#e4e4e7;color:#888;border:1px dashed #aaa;padding:8px 10px;font-size:10px}
.orig img{display:block;max-width:420px}.note{color:#a60;font-size:10px}`;

const browser = await launchBrowser();
mkdirSync(outDir, { recursive: true });
const index = [`# Component sheets — ${file}`, ''];
for (const comp of comps) {
  const vs = comp.variants.slice(0, maxVariants);
  const rows = [];
  for (const v of vs) {
    const c = await crop(browser, v.evidence ?? []);
    const orig = c ? `<div class="orig"><img src="${c.src}">${c.note ? `<div class="note">${c.note}</div>` : ''}</div>` : '<div class="ph">no usable crop</div>';
    const cap = `<div class="cap"><b>${esc(v.suggestedName ?? v.id)}</b> &middot; ${v.count}×${v.dataVariant ? ` &middot; data-variant=${esc(v.dataVariant)}` : ''}<br><small>${esc(roleLabels(v))}</small></div>`;
    rows.push(`<tr><td>${cap}${orig}</td><td><div class="stage">${redraw(v, comp)}</div></td><td><div class="strip">${stateStrip(v, comp)}</div></td></tr>`);
  }
  const html = `<!doctype html><meta charset=utf-8><style>${CSS}</style><h2>${esc(comp.name)} — ${comp.instances} instances, ${comp.variants.length} variants${comp.variants.length > vs.length ? ` (showing ${vs.length})` : ''}</h2>
<table><tr><th>A. original (live page)</th><th>B. redrawn from extract</th><th>C. states</th></tr>${rows.join('')}</table>`;
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 400 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setContent(html);
  const buf = await p.locator('body').screenshot();
  writeFileSync(join(outDir, `${comp.name}.png`), Buffer.from(buf));
  await ctx.close();
  index.push(`## ${comp.name}`, `${comp.instances} instances, ${comp.variants.length} variants`, '', `![${comp.name}](${comp.name}.png)`, '');
  console.log(`${comp.name}.png  (${(buf.length / 1024).toFixed(0)} KB)`);
}
writeFileSync(join(outDir, 'index.md'), index.join('\n'));
for (const s of shots.values()) await s.ctx?.close();
await browser.close();
