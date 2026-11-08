# Components: the shadcn/ui reference table

`extract` reads a page and, besides colours, type and scales, looks for every component of the
shadcn/ui set (https://ui.shadcn.com/docs/components) and writes what it finds under
`inferred.catalog` of `extract.json` (schema 0.2). report.md has the table "기준표 대비 컴포넌트":
every table entry, found or not, with why a missing one is often missing.

## The table

`packages/engine/catalog/shadcn-components.json` — 68 entries (the 65 `registry:ui` entries of
ui.shadcn.com/r/index.json, snapshot 2026-11-08, plus the docs-only data-table, date-picker and
typography). Per entry:

| field | meaning |
|---|---|
| `cues` | how to recognise the root: `tag`, `role` (explicit or implicit ARIA), `slot` (`data-slot`, which shadcn/ui v4 sets on every part), `attrs` (aria-*, data-state, data-variant…), `inputType`, `hint` (class-name words from a fixed list; weak), `inside` (an ancestor cue). A cue matches when all its fields do; the entry matches when any cue does. |
| `structure` | a built-in matcher in `src/catalog/match.ts` for components with no role or tag (badge, card, avatar, sidebar, …). |
| `parts` | sub-parts as shadcn names them (Card header/content/footer…), found inside the root. |
| `props` | what to read: background, color, border, borderWidth, radius, paddingX/Y, height, width, gap, shadow, typeStyle, opacity. |
| `states` / `stateCues` | the states the component has, and the cue that marks an example of each on the page (checked, open, disabled…). |
| `detectable` / `hintWhenMissing` | `static`, `on-interaction` (only exists open), `rare`, `non-visual`; and what to do when it is missing. |

Adding a component is a JSON edit; `test/catalog.test.ts` checks the table against the shadcn list.

## What is read

1. `src/catalog/probe.ts` runs in the page and reports attributes with short enum-like values,
   `data-slot`, class-name words from a fixed list and whether an icon sits inside. No text, URL,
   id or class name leaves the page. The engine's snapshot (the sweep) is unchanged.
2. `match.ts` claims each element for the entry whose cue is most specific; a nested element of
   the same component is a part, not another instance.
3. `analyze.ts` groups an entry's instances by look (data-variant, background, text, border,
   radius) into **variants**, sizes (height clusters) stay a separate axis, and elements that are
   in a state (checked, open, disabled…) are kept as examples of that state, not as variants.
4. `:hover`, `:focus-visible` and `:active` are forced (CDP) on up to two examples of each look.
5. `build.ts` merges all pages read, ties each value to a token role and writes the result:
   colours → colour role (`exact`, or `nearest` within ΔE 0.04), radius → `radius.N`, spacing →
   `space.N` (steps of the inferred scales), type → `type.<role>`; `match: none` when nothing fits.
   Values are of the first (primary) mode.

Every value carries evidence (selector, rect, page, width) and a confidence; a state that could not
be read has a `limit` that says why. The per-page reads are kept in `PageData.catalog`, so a crawl
(`styles.json` per screen) can be merged later.

## Reading more pages

`equipe-design extract <url…> --max-pages 40` reads up to 200 URLs on one origin (default 5).

## Checking the result

- `node scripts/component-sheets.mjs extract.json out/` — per component, the original crop next to
  a redraw from the extracted values, and a state strip.
- `node scripts/verify-states.mjs extract.json --samples 10` — repeats hover / focus / disabled
  on the real page and compares the measured values with the extracted ones.
