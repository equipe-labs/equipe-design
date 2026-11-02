# Accuracy eval

Scores equipe-design, designlang 13.3.2 and Dembrandt 0.39.2 against hand-checked answers for a
small set of public sites, and writes a side-by-side table (design README 5).

```sh
npm install --prefix eval/tools          # once: the two competitors, pinned (not a workspace)
equipe-design eval                       # run all three tools on every site → eval/out/<date>/scoreboard.md
equipe-design eval --sites equipe.im --tools equipe-design
equipe-design eval --from <folder>       # re-score earlier runs; visits nothing
npx vitest run -c eval/vitest.config.ts  # harness tests (EQUIPE_T257_DIR=<T-257 원본출력> adds the reproduction test)
```

It visits external sites, so it is run by hand — never on a schedule.

## Files

| Path | What |
|---|---|
| `sites.json` | The set, the rows (metrics) for each site and their goals |
| `answers/<host>.json` | Ground truth. Every section has a `source` link; the file has `checkedAt`. Older than 30 days → warning |
| `notes/primer-carbon.md` | Why primer.style was replaced by atlassian.design, and how carbondesignsystem.com was checked |
| `runners/competitors.mjs` | Runs designlang / Dembrandt with T-257's flags into the T-257 folder layout |
| `src/adapters.ts` | Each tool's output folder → one common shape |
| `src/score.ts` | The metrics |
| `src/run.ts` | Runs, scores, writes `scoreboard.md` and `scores.json` |
| `out/` | Runs (git-ignored) |

## Sites

| Site | Answer from | Rows |
|---|---|---|
| equipe.im | equipe `design/build/css/tokens.css` | spacing, radius, dark pairs, colours, fonts, brand |
| ui.shadcn.com | The site's own `:root` / `.dark` variables | dark values per variable, dark pairs, colours, radius, fonts |
| atlassian.design (replaces primer.style) | `@atlaskit/tokens` 20.9.0, inlined in the home page | colours, dark pairs, spacing, radius, type, brand |
| carbondesignsystem.com | `@carbon/themes` 11.84.0 g10, `@carbon/layout`, `@carbon/type` | colours, spacing, type, brand (no dark mode, no radius) |
| linear.app, raycast.com | T-218 notes | brand colour, dark-only |
| vercel.com (spare, `--spare`) | T-218 notes | background/text, fonts |

primer.style declares `@primer/primitives` but draws its home page with Primer Brand tokens, so the
public token set is not what a page reader sees — see `notes/primer-carbon.md`.

## Metrics

| Row | How it is counted |
|---|---|
| Colours | Answer colours used on the page whose light value appears anywhere in the tool's output (ΔE_OK < 0.02, alpha ignored). `usedOnPage: false` answers are left out of the denominator. Dark values the tool missed are named |
| Dark pairs | Unique opaque (light, dark) answer pairs the tool reproduced · how many of the tool's own pairs are right. designlang's pairs are its Figma variables; equipe-design's are its roles plus variables; Dembrandt has none |
| Dark values | For answer colours with a role: the tool's dark value for that variable (or role) equals the answer's |
| Spacing / radius | recall = answer steps in the tool's steps; precision = tool steps that are answer steps / all tool steps (radius counts non-px values like `50%` too) |
| Type | Font family names (ignoring `Variable`/quotes) and, where given, font-size steps |
| Brand | ✓ same colour (or `none`); △ `uncertain` with the right top candidate, or a grey when the answer is `none`; ✗ otherwise |
| dark-only | equipe-design's `dark-only` limit; the other tools don't judge it |
| Time | Seconds per site from each run's `status.txt` (Dembrandt: the dark run) |

Re-scoring T-257's raw outputs with these rules gives T-257's numbers (equipe.im spacing 4/9 · 4/23 and
9/9 · 9/20, radius 1/5 · 1/10 and 4/5 · 4/15, designlang's 9/24 right Figma pairs, colours 21/21, linear ✗ / △,
raycast ✗ / ✓) — the test above checks it. One difference: T-257 matched exact hex and so listed Dembrandt's
dark `border-strong` (#7c7e85) as missing; with ΔE_OK < 0.02 the nearby `#80828a` counts.
