// Opens UI that only shows when asked — menus, dropdowns, dialogs, tabs, <details> — and keeps
// a screenshot and a style sweep of each. Only disclosure controls are pressed (aria-haspopup,
// aria-expanded="false", <summary>, role="tab", dropdown toggles). Never: a link that would
// navigate, a submit button, a control wired to a request (hx-post, data-method, formaction…),
// or anything whose name is an action (rules.ts). While a control is pressed, page navigations
// are aborted too, so a press can't leave the page; requests stay GET/HEAD only as always.

import type { Page } from 'playwright-core';
import { callInPage } from '../capture/page.ts';
import type { SweepResult } from '../capture/inpage.ts';
import { sleep } from '../guard/budget.ts';
import { actionInLabel } from './rules.ts';

export interface RevealCandidate {
  id: string;
  tag: string;
  label: string;
  kind: 'menu' | 'dialog' | 'tab' | 'details' | 'listbox';
  href: string | null;
  inForm: boolean;
  type: string | null;
  wired: string[];
}

export interface Revealed {
  label: string;
  kind: RevealCandidate['kind'];
  sweep: SweepResult;
  shot: Buffer;
}

export interface RevealSkip {
  label: string;
  reason: string;
}

const TRIGGERS = [
  '[aria-haspopup]:not([aria-haspopup="false"])',
  '[aria-expanded="false"]',
  'details:not([open]) > summary',
  '[role="tab"][aria-selected="false"]',
  '[data-bs-toggle="dropdown"]',
  '[data-toggle="dropdown"]',
  '.dropdown-toggle',
].join(',');

/** Marks visible triggers with data-eqd-reveal and describes them. The name is the visible text (innerText), so a closed menu's items don't count as the trigger's name. */
function listTriggers({ selector, max }: { selector: string; max: number }): RevealCandidate[] {
  const out: RevealCandidate[] = [];
  let i = 0;
  for (const el of Array.from(document.querySelectorAll(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const popup = el.getAttribute('aria-haspopup');
    const kind = el.matches('[role="tab"]') ? 'tab' : tag === 'summary' ? 'details' : popup === 'dialog' ? 'dialog' : popup === 'listbox' ? 'listbox' : 'menu';
    const type = tag === 'button' ? (el.getAttribute('type') || 'submit').toLowerCase() : tag === 'input' ? (el as HTMLInputElement).type : null;
    const wired = Array.from(el.attributes)
      .map((a) => a.name)
      .filter((n) => /^(hx-(post|put|patch|delete|get)|data-(method|turbo-method|confirm|remote|url|action|href)|formaction|formmethod)$/.test(n));
    const id = `r${i++}`;
    el.setAttribute('data-eqd-reveal', id);
    out.push({ id, tag, label, kind, href: tag === 'a' ? el.getAttribute('href') : null, inForm: !!el.closest('form'), type, wired });
    if (out.length >= max) break;
  }
  return out;
}

/** What is open right now: visible popups (menus, listboxes, dialogs, open details) and visible element count. */
function openState(): { popups: number; visible: number; url: string } {
  const popupSel = '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"],[role="tooltip"],dialog[open],details[open],[data-state="open"],.dropdown-menu.show,.menu.visible,.popover';
  const vis = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0;
  };
  let visible = 0;
  for (const e of Array.from(document.body?.querySelectorAll('*') ?? [])) if (vis(e)) visible++;
  return { popups: Array.from(document.querySelectorAll(popupSel)).filter(vis).length, visible, url: location.href };
}

/** Why a trigger must not be pressed, or null. */
export function revealRefusal(c: Pick<RevealCandidate, 'label' | 'href' | 'inForm' | 'type' | 'wired' | 'tag'>): string | null {
  const action = actionInLabel(c.label, 'control');
  if (action) return `바꾸는 동작으로 보임(${action})`;
  if (c.wired.length) return `요청에 연결된 컨트롤(${c.wired.join(', ')})`;
  if (c.type === 'submit' || c.type === 'image' || c.type === 'reset') return c.inForm ? '폼 제출 버튼' : `type=${c.type} 버튼`;
  if (c.href && !/^(#.*|javascript:\s*(void\(0\);?)?)?$/i.test(c.href.trim())) return '누르면 다른 주소로 이동하는 링크';
  return null;
}

/**
 * Presses up to `max` safe triggers one at a time, keeps what each opened, then closes it
 * (Escape, then the trigger again, then a reload as a last resort).
 * `setNavigationBlocked` makes the context's route abort page navigations meanwhile.
 */
export async function reveal(page: Page, opts: { max: number; setNavigationBlocked: (on: boolean) => void; reload: () => Promise<void> }): Promise<{ revealed: Revealed[]; skipped: RevealSkip[]; clicks: number }> {
  const revealed: Revealed[] = [];
  const skipped: RevealSkip[] = [];
  let clicks = 0;
  if (opts.max <= 0) return { revealed, skipped, clicks };
  const candidates = await page.evaluate(listTriggers, { selector: TRIGGERS, max: opts.max * 6 }).catch(() => [] as RevealCandidate[]);
  const seen = new Set<string>();
  // One of each kind first (a menu, a dialog, a tab…), then the rest; at most two FAQ-style <details>.
  const isFirst = (c: RevealCandidate) => candidates.findIndex((x) => x.kind === c.kind) === candidates.indexOf(c);
  const ordered = [...candidates.filter(isFirst), ...candidates.filter((c) => !isFirst(c))];
  const perKind = new Map<string, number>();
  for (const c of ordered) {
    if (revealed.length >= opts.max) break;
    const key = `${c.kind}|${c.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.kind === 'details' && (perKind.get('details') ?? 0) >= 2) continue;
    const refusal = revealRefusal(c);
    if (refusal) {
      skipped.push({ label: c.label || `<${c.tag}>`, reason: refusal });
      continue;
    }
    const before = await page.evaluate(openState).catch(() => null);
    if (!before) continue;
    opts.setNavigationBlocked(true);
    try {
      const target = page.locator(`[data-eqd-reveal="${c.id}"]`).first();
      // After a reload the marks are set again; press only if the mark is still on the same control.
      const still = await target
        .evaluate((el) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 80))
        .catch(() => null);
      if (still !== c.label) continue;
      clicks++;
      await target.click({ timeout: 2_000, noWaitAfter: true }).catch(() => undefined);
      await sleep(450);
      const after = await page.evaluate(openState).catch(() => null);
      if (!after) continue;
      const opened = after.popups > before.popups || Math.abs(after.visible - before.visible) >= 3;
      if (opened && after.url === before.url) {
        const sweep = await callInPage(page, 'sweep');
        const shot = await page.screenshot({ type: 'jpeg', quality: 75, animations: 'disabled', caret: 'hide' });
        revealed.push({ label: c.label || `<${c.tag}>`, kind: c.kind, sweep, shot });
        perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
      }
      // close it again
      await page.keyboard.press('Escape').catch(() => undefined);
      await sleep(200);
      let now = await page.evaluate(openState).catch(() => null);
      if (now && c.kind !== 'tab' && (now.popups > before.popups || Math.abs(now.visible - before.visible) >= 3)) {
        clicks++;
        await target.click({ timeout: 2_000, noWaitAfter: true }).catch(() => undefined);
        await sleep(250);
        now = await page.evaluate(openState).catch(() => null);
      }
      if (!now || now.url !== before.url || now.popups > before.popups || (c.kind !== 'tab' && Math.abs(now.visible - before.visible) >= 3)) {
        opts.setNavigationBlocked(false);
        await opts.reload();
        await page.evaluate(listTriggers, { selector: TRIGGERS, max: opts.max * 6 }).catch(() => undefined);
      }
    } finally {
      opts.setNavigationBlocked(false);
    }
  }
  return { revealed, skipped, clicks };
}
