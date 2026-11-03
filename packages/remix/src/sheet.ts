// The review sheet: one PNG per remix with swatches, type, a few components and the contrast result (same idea as T-145 sheets.mjs).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Remix } from './remix.ts';
import { ROLES, type ColorMap, type Mode } from './model.ts';
import { contrast } from './color.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const stack = (a: string[]) => a.map((f) => (/[\s\d]/.test(f) && !/^ui-/.test(f) ? `'${f}'` : f)).join(', ');
const chromePath = () => process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function panel(r: Remix, mode: Mode, c: ColorMap): string {
  const m = r.model;
  const sans = stack(m.fonts.sans);
  const mono = stack(m.fonts.mono);
  const disp = stack(m.fonts.display ?? m.fonts.sans);
  const t = (role: 'display' | 'h1' | 'h2' | 'body' | 'small') => {
    const s = m.type[role]!;
    return `font:${s.weight} ${Math.min(s.size, role === 'display' ? 46 : 40)}px/${s.lineHeight} ${role === 'display' || role === 'h1' || role === 'h2' ? disp : sans};letter-spacing:${s.letterSpacing}em`;
  };
  const rad = m.radius[Math.min(1, m.radius.length - 1)] ?? 8;
  const radL = m.radius[Math.min(2, m.radius.length - 1)] ?? 12;
  const fails = r.contrast.pairs.filter((p) => p.mode === mode);
  const bad = fails.filter((p) => !p.ok).length;
  const shadow = m.shadows[0]?.map((l) => `${l.offsetX}px ${l.offsetY}px ${l.blur}px ${l.spread}px ${l.color}${Math.round(l.alpha * 255).toString(16).padStart(2, '0')}`).join(',') ?? 'none';
  const sw = ROLES.map((role) => {
    const on = contrast(c[role], c.background) >= 3 ? c[role] : c.text;
    return `<div class="sw" style="background:${c[role]};color:${contrast('#fff', c[role]) > contrast('#000', c[role]) ? '#fff' : '#000'}"><b>${role}</b><span>${c[role]}</span></div>`.replace('${on}', on);
  }).join('');
  return `<section style="background:${c.background};color:${c.text};font-family:${sans}">
    <div class="mode"><span>${mode}</span><em style="color:${bad ? '#c00' : c['muted-text']}">${bad ? `${bad} contrast fails` : `AA: ${fails.length} checks, 0 fails`}</em></div>
    <div class="grid">${sw}</div>
    <h1 style="${t('display')};margin:22px 0 4px">Ship the thing</h1>
    <h2 style="${t('h2')};margin:0 0 8px;color:${c.text}">A heading in the remixed type</h2>
    <p style="${t('body')};margin:0 0 4px;max-width:560px">Body text on the background. <a style="color:${c.accent};text-decoration:underline">A link in the accent colour</a> and <span style="color:${c['muted-text']}">muted text for secondary lines.</span></p>
    <p style="font:${m.type.mono?.weight ?? 400} 13px/1.5 ${mono};margin:0 0 16px;color:${c['muted-text']}">const brand = "${r.meta.brand.applied ?? ''}";</p>
    <div class="row">
      <button style="background:${c.primary};color:${c['on-primary']};border:0;border-radius:${rad}px;padding:10px 18px;font:600 14px ${sans}">Primary</button>
      <button style="background:${c.secondary};color:${c.text};border:1px solid ${c.border};border-radius:${rad}px;padding:10px 18px;font:600 14px ${sans}">Secondary</button>
      <input value="Input" readonly style="background:${c.background};color:${c.text};border:1px solid ${c['border-strong']};border-radius:${rad}px;padding:9px 12px;font:14px ${sans};width:120px;outline:2px solid ${c.ring};outline-offset:2px">
      <span class="chip" style="color:${c.destructive}">error</span><span class="chip" style="color:${c.success}">ok</span><span class="chip" style="color:${c.warning}">warn</span>
    </div>
    <div style="margin-top:16px;background:${c.surface};border:1px solid ${c.border};border-radius:${radL}px;padding:16px 18px;box-shadow:${shadow};max-width:420px">
      <b style="${t('small')};color:${c.text}">Card on surface</b><div style="${t('small')};color:${c['muted-text']};margin-top:4px">Border, surface and radius from the remix.</div>
    </div></section>`;
}

export function sheetHtml(r: Remix): string {
  const { meta } = r;
  const ramp = Object.entries(meta.brand.ramp).map(([s, h]) => `<div style="background:${h}"><i>${s}</i></div>`).join('');
  const adj = meta.adjustments.length ? meta.adjustments.map((a) => `${a.mode} ${a.role}: ${a.from} → ${a.to}`).join(' · ') : 'none';
  const dark = r.model.colors.dark;
  return `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;background:#f2f2f2;font:14px system-ui,sans-serif;color:#111}
  .wrap{width:1400px;padding:28px 32px 24px}
  h3{margin:0;font:700 22px system-ui} .sub{color:#555;margin:4px 0 14px;font-size:13px}
  .ramp{display:flex;height:34px;border-radius:8px;overflow:hidden;margin-bottom:6px} .ramp div{flex:1;position:relative} .ramp i{position:absolute;bottom:2px;left:4px;font:10px ui-monospace,monospace;color:#fff;mix-blend-mode:difference;font-style:normal}
  .cols{display:grid;grid-template-columns:${dark ? '1fr 1fr' : '1fr'};gap:16px} section{border-radius:14px;padding:18px 20px;border:1px solid #0002}
  .mode{display:flex;justify-content:space-between;font:600 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px} .mode em{font-style:normal;text-transform:none}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px} .sw{border-radius:8px;padding:8px;height:56px;border:1px solid #0002;display:flex;flex-direction:column;justify-content:space-between} .sw b{font:600 11px system-ui} .sw span{font:10px ui-monospace,monospace}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap} .chip{font:600 12px system-ui;padding:3px 8px;border:1px solid currentColor;border-radius:99px}
  .foot{margin-top:12px;font:12px/1.5 ui-monospace,monospace;color:#444} .foot b{color:#111}
  </style><div class="wrap">
  <h3>${esc(meta.name)} — variant ${esc(r.id)}</h3>
  <div class="sub">${esc(r.label)} · brand ${esc(meta.brand.applied ?? '')}${meta.brand.kept ? ' (kept, own site)' : ` (original ${esc(meta.brand.original.light ?? 'none')} replaced)`} · contrast: ${r.contrast.fails.length} fails of ${r.contrast.checked}</div>
  <div class="ramp">${ramp}</div>
  <div class="cols">${panel(r, 'light', r.model.colors.light)}${dark ? panel(r, 'dark', dark) : ''}</div>
  <div class="foot"><b>contrast fixes:</b> ${esc(adj)}<br><b>fonts:</b> ${esc(r.model.fonts.sans[0] ?? '')} / ${esc(r.model.fonts.mono[0] ?? '')}${meta.fonts.length ? ` (swapped: ${meta.fonts.map((f) => `${f.from}→${f.to}`).join(', ')})` : ''}${dark ? '' : '<br><b>no dark theme in the source</b>'}</div>
  </div>`;
}

/**
 * Renders the sheet with headless Chrome. Returns false when Chrome is not installed.
 * Chrome gets a new, empty profile of its own (deleted after), never the person's — the same rule
 * as the engine's browser (packages/mcp/src/browser.ts).
 */
export function renderSheet(r: Remix, png: string): boolean {
  const chrome = chromePath();
  if (!existsSync(chrome)) return false;
  const dir = mkdtempSync(join(tmpdir(), 'eqd-sheet-'));
  try {
    const html = join(dir, 'sheet.html');
    const profile = join(dir, 'profile');
    mkdirSync(profile);
    writeFileSync(html, sheetHtml(r));
    mkdirSync(dirname(png), { recursive: true });
    execFileSync(
      chrome,
      ['--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--screenshot=${png}`, '--window-size=1400,820', `file://${html}`],
      { stdio: 'ignore', timeout: 60_000 },
    );
    return existsSync(png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
