#!/usr/bin/env node
// Check catalog state diffs against what the live page really does (real hover / focus / mouse-down).
// Usage: node scripts/verify-states.mjs <extract.json> [--samples 10] [--out report.md]
// Report only: always exits 0. Never clicks or submits (mouse-up happens away from the element).
/* global document, window, getComputedStyle */
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchBrowser } from '../packages/engine/src/capture/page.ts';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('usage: verify-states.mjs <extract.json> [--samples 10] [--out report.md]'); process.exit(0); }
const N = Number(flag('--samples', 10));
const out = flag('--out', '');

const ex = JSON.parse(readFileSync(file, 'utf8'));
const colors = new Map((ex.observed?.color ?? []).map((c) => [c.id, c.value]));
const pages = ex.source?.pages ?? [];
const comps = ex.inferred?.catalog?.components ?? [];

// Pick samples: round-robin over components, interleaving state kinds.
const PRIORITY = ['hover', 'focus-visible', 'active', 'disabled'];
const real = (diff) => Object.entries(diff ?? {}).filter(([, v]) => v !== 'changed');
const perComp = comps.map((c) => {
  const byState = new Map(PRIORITY.map((n) => [n, []]));
  for (const v of c.variants) {
    for (const s of v.states ?? []) {
      if (!s.observed || !byState.has(s.name) || !real(s.diff).length) continue;
      if (s.method !== 'forcePseudoState' && s.method !== 'on-page-example') continue;
      const evs = (s.evidence?.length ? s.evidence : v.evidence ?? []).filter((e) => e.rect[1] >= 0);
      if (evs.length) byState.get(s.name).push({ comp: c.name, variant: v.suggestedName ?? v.id, state: s.name, diff: s.diff, ev: evs[0], evs });
    }
  }
  const list = [];
  for (let i = 0; list.length < 40; i++) {
    let any = false;
    for (const l of byState.values()) if (l[i]) { list.push(l[i]); any = true; }
    if (!any) break;
  }
  return list;
});
const samples = [];
for (let r = 0; samples.length < N; r++) {
  let any = false;
  for (const l of perComp) if (l[r] && samples.length < N) { samples.push(l[r]); any = true; }
  if (!any) break;
}

// Parse a colour id ("c10") or "none" into {r,g,b,a}.
function parseId(id) {
  if (id === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  const v = colors.get(id);
  if (!v) return null;
  const h = v.hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: v.alpha ?? 1 };
}
const fmt = (c) => (c ? `${'#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}${c.a < 1 ? `@${+c.a.toFixed(2)}` : ''}` : '?');
const near = (a, b) => (a.a < 0.02 && b.a < 0.02) || (Math.abs(a.r - b.r) <= 2 && Math.abs(a.g - b.g) <= 2 && Math.abs(a.b - b.b) <= 2 && Math.abs(a.a - b.a) <= 0.02);

// In-page: tag the element under the evidence rect, then (later) measure it.
function findTarget([x, y, w, h]) {
  window.scrollTo(0, Math.max(0, y + h / 2 - window.innerHeight / 2));
  const cx = x + w / 2 - window.scrollX, cy = y + h / 2 - window.scrollY;
  let el = document.elementFromPoint(cx, cy);
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    const b = el.getBoundingClientRect();
    if (Math.abs(b.left + window.scrollX - x) <= 3 && Math.abs(b.top + window.scrollY - y) <= 3 && Math.abs(b.width - w) <= 3 && Math.abs(b.height - h) <= 3) {
      document.querySelectorAll('[data-eqv]').forEach((n) => n.removeAttribute('data-eqv'));
      el.setAttribute('data-eqv', '1');
      return true;
    }
  }
  return false;
}
function measure() {
  const el = document.querySelector('[data-eqv]');
  const cs = getComputedStyle(el);
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (s) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = s; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: +(d[3] / 255).toFixed(3) }; };
  const layers = cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).filter((l) => !/rgba\(0, 0, 0, 0\)/.test(l));
  return {
    'background-color': rgba(cs.backgroundColor), color: rgba(cs.color),
    'border-color': cs.borderTopWidth === '0px' || cs.borderTopStyle === 'none' ? { r: 0, g: 0, b: 0, a: 0 } : rgba(cs.borderTopColor),
    opacity: Number(cs.opacity), 'box-shadow': layers.length ? 'shadow' : 'none',
    outline: cs.outlineStyle === 'none' || cs.outlineWidth === '0px' ? 'none' : { w: cs.outlineWidth, c: rgba(cs.outlineColor) },
    focusVisible: el.matches(':focus-visible'), disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true',
  };
}

const browser = await launchBrowser();
const open = new Map();
let lastLoad = 0;
async function getPage(s) {
  const key = `${s.ev.page}@${s.ev.width}@${s.ev.mode}`;
  if (open.has(key)) return open.get(key);
  const wait = 1000 - (Date.now() - lastLoad);
  if (wait > 0) await sleep(wait);
  const ctx = await browser.newContext({ viewport: { width: s.ev.width, height: 900 }, colorScheme: s.ev.mode === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(pages[s.ev.page].url, { waitUntil: 'load', timeout: 45000 });
  await sleep(1500);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  lastLoad = Date.now();
  open.set(key, { page, ctx });
  return open.get(key);
}

const rows = [];
const bad = [];
let n = 0;
for (const s of samples) {
  n++;
  const tag = `${s.comp}/${s.variant}/${s.state}`;
  const push = (prop, extracted, measured, ok, guess) => {
    rows.push(`| ${n} | ${s.comp} | ${s.variant} | ${s.state} | ${prop} | ${extracted} | ${measured} | ${ok ? '✓' : '✗'} |`);
    if (!ok) bad.push(`- #${n} ${tag} ${prop}: ${guess}`);
    return ok;
  };
  try {
    const { page } = await getPage(s);
    await page.mouse.move(0, 0);
    let found = false;
    for (const e of s.evs.slice(0, 3)) if ((found = await page.evaluate(findTarget, e.rect))) break;
    if (!found) { for (const [p, d] of real(s.diff)) push(p, d.split('->').pop().trim(), 'element not found', false, 'no element matches the evidence rect (page changed, sticky/overlay, or rect off)'); continue; }
    const el = page.locator('[data-eqv]');
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    let down = false;
    if (s.state === 'hover') await page.mouse.move(cx, cy);
    else if (s.state === 'active') { await page.mouse.move(cx, cy); await page.mouse.down(); down = true; }
    else if (s.state === 'focus-visible') {
      await el.evaluate((e) => e.focus({ focusVisible: true }));
      if (!(await el.evaluate((e) => e.matches(':focus-visible')))) {
        await page.evaluate(() => { document.activeElement?.blur(); });
        for (let i = 0; i < 80; i++) { await page.keyboard.press('Tab'); if (await el.evaluate((e) => e === document.activeElement)) break; }
      }
    }
    await sleep(150);
    const m = await page.evaluate(measure);
    if (down) { await page.mouse.move(2, 2); await page.mouse.up(); }
    if (s.state === 'focus-visible' && !m.focusVisible) { for (const [p, d] of real(s.diff)) push(p, d.split('->').pop().trim(), 'could not focus-visible', false, 'element not keyboard-focusable here; wrong element picked?'); continue; }
    for (const [p, d] of real(s.diff)) {
      const [before, after] = d.split('->').map((t) => t.trim());
      if (p === 'opacity') { const ok = Math.abs(m.opacity - Number(after)) <= 0.02; push(p, after, m.opacity, ok, 'opacity differs; probably an ancestor or a different element was measured'); }
      else if (p === 'box-shadow') { const ok = m['box-shadow'] === (after === 'none' ? 'none' : 'shadow'); push(p, after, m['box-shadow'], ok, ok ? '' : `engine says ${after}, page shows ${m['box-shadow']} (ring may be an outline or a ::after)`); }
      else if (p === 'outline') {
        const w = /^(\S+)\s+(c\d+)$/.exec(after); const want = w ? parseId(w[2]) : null;
        const ok = after === 'none' ? m.outline === 'none' : m.outline !== 'none' && (!want || near(want, m.outline.c)) && (!w || m.outline.w === w[1]);
        push(p, after, m.outline === 'none' ? 'none' : `${m.outline.w} ${fmt(m.outline.c)}`, ok, 'outline differs; the engine may read outline from a different pseudo-state than real focus-visible');
      } else if (m[p] && typeof m[p] === 'object') {
        const want = parseId(after); const got = m[p];
        const ok = !!want && near(want, got);
        push(p, `${after} ${fmt(want)}`, fmt(got), ok, ok ? '' : `${want && near(parseId(before) ?? want, got) ? 'state change did not happen on the page (still the "before" value)' : 'a different colour than extracted (alpha compositing, different element, or colour-mix)'}`);
      } else push(p, after, 'not measurable', false, 'property not supported by the verifier');
    }
  } catch (e) { for (const [p, d] of real(s.diff)) push(p, d.split('->').pop().trim(), 'error', false, e.message.split('\n')[0]); }
}
for (const o of open.values()) await o.ctx.close();
await browser.close();

const total = rows.length, okN = rows.filter((r) => r.endsWith('✓ |')).length;
const report = [`# State verification — ${file}`, '', `${samples.length} samples from ${comps.length} components`, '',
  '| # | component | variant | state | property | extracted (after) | measured on page | match |', '|---|---|---|---|---|---|---|---|', ...rows, '',
  `**${okN} of ${total} properties match**`, '', bad.length ? '## Mismatches' : '', ...bad, ''].join('\n');
console.log(report);
if (out) writeFileSync(out, report);
process.exit(0);
