# @equipe-design/engine

`extract(urls, opts)` reads up to five pages in a fresh headless Chrome and returns an `Extraction` (schema 0.1); `report(x)` renders `report.md`; `writeRun(x, dir)` writes the two files of a run.

```ts
import { extract, writeRun } from '@equipe-design/engine';
const { extraction, exitCode } = await extract(['https://equipe.im/']);
writeRun(extraction, 'out/equipe.im');
```

## Pipeline

| Step | Where | What it does |
|---|---|---|
| Guard | `src/guard/` | `robots.ts` (RFC 9309, before any page request), `budget.ts` (5 URLs, same origin, 1 s apart, 60 s a page), `session.ts` (login wall / bot check → stop) |
| Capture | `src/capture/` | `page.ts` opens a new context (empty profile, `reducedMotion: reduce`, GET/HEAD only via `route.ts`), scrolls, hides cookie banners with CSS, sweeps computed styles (`inpage.ts`) at each width and mode, forces `:hover`/`:focus-visible`/`:active` through CDP |
| Observe | `src/analyze/observe.ts` | colours (OKLab ΔE < 0.02 merges, alpha apart), type styles, spacing, radius, shadow, motion, z-index, breakpoints, CSS variables with their light/dark values |
| Infer | `src/analyze/` | `scale.ts` (spacing/radius/font-size), `infer.ts` (roles with light/dark pairs, brand, type roles), `components.ts` (role → fingerprint → variants, sizes, states) |
| Report | `src/report.ts` | `report.md` |

Dark mode is tried three ways: `prefers-color-scheme` (Playwright `emulateMedia`), a class/data toggle on `<html>` (`.dark`, `[data-theme=dark]`, …), and variables declared under a dark condition. Light and dark values are paired by element (same DOM path, same property), with the variable as a tie-breaker. A dark page whose dark rules change nothing is reported `dark-only`.

## Changes from the design (T-279 README)

- **Brand colour rule (2.7).** As first written, raycast.com came out `none`: `#ff6363` is the logo colour and an eyebrow/label colour, not a button or link colour, so "interactive use" was 0. Two changes, measured on equipe.im, ui.shadcn.com, linear.app and raycast.com (2026-11-02):
  1. An **identity** signal: the colour of the home link at the top of the page (the logo) or of `<meta name="theme-color">`. It is reported in `signals.themeColorMeta` (schema 0.1 has no separate field). Weights are now `0.3 interactive + 0.2 spread + 0.15 variable name + 0.1 variety + 0.25 identity` (were 0.35/0.25/0.2/0.1/0.1).
  2. `found` also when the top candidate has the identity signal, scores ≥ 0.4 and leads the second by ≥ 0.25 (raycast: 0.49 vs 0.05). Otherwise ≥ 0.5 and a 0.15 lead, as designed.
  3. `singleSubtree` (×0.3) now also applies to colours on fewer than three elements. linear.app's yellow `#e4f222` sits in two customer cards that are links, so it scored as "interactive"; with the penalty it drops to 0.10 and the verdict is `none`, as the answer key says.
- **Sections.** "Spread" counts top-level landmarks/sections, but pages wrapped in one big container (raycast) had only one or two. A container covering more than half the page no longer counts as a section; elements outside any smaller section fall back to 900 px bands of the page.
- **Transitions.** Values are read with transitions switched off after the first sweep (transition values are taken from that first sweep). Before, a 150 ms fade after switching to dark was caught halfway and gave colours no stylesheet declares.
- **Close colours declared by variables stay apart.** `#16171a` and `#17171c` are ΔE 0.005 apart but two tokens; when both are declared exactly by variables they are not merged.
- **Roles.** `text` is the text colour with the largest text box area (many small labels in a product mock-up outvoted the body copy by count); `surface` is the largest-area box background other than the page.
- **Cross-origin CSS** is parsed by the browser itself (`new CSSStyleSheet().replaceSync(text)` on the response body Playwright already holds) instead of postcss; the text is dropped right after. **OKLCH** is computed here (Ottosson's matrices) instead of culori. No new dependencies besides `playwright-core`.
- **Roles from the accessibility tree** use the element's `role` attribute and the implicit role of its tag, not CDP `Accessibility.getFullAXTree`.

## Not done yet

- Screenshot comparison when a forced state shows no computed-style difference (reported as `state-no-diff`).
- `--inject-states` (cloned elements with `disabled`); disabled states come only from examples on the page.
- `DOMSnapshot.captureSnapshot` vs `getComputedStyle` timing (the latter is used; equipe.im takes about 7 s for 2 widths × 2 modes + states).
- LLM name suggestions (out of scope for now).

## Measured (2026-11-02, Chrome 156, this Mac)

| Site | Result | Time |
|---|---|---|
| equipe.im | spacing 9/9, radius 4/5 (+4, 10), dark pairs 17/17, brand `#1d4ed8` found | 6.9 s |
| ui.shadcn.com | dark by class toggle (`html.dark`), `--background` light ≠ dark, brand none | 7.9 s |
| linear.app | dark-only, brand none | 17 s |
| raycast.com | dark-only, brand `#ff6363` found | 9 s |

Answer keys: equipe.im from `equipe/design/build/css/tokens.css` and the site's own variables; linear/raycast from the T-218 notes. These are four sites; the weights are not yet checked on the full evaluation set (ticket D).
