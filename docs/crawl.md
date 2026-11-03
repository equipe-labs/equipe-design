# Crawl: every screen of a service, signed in, reading only

`equipe-design extract --crawl <url>` (MCP: `design_extract` with `crawl: true`) starts from one
page and reads every screen it can find: the sitemap, links on the same origin, and the app's own
navigation (sidebars, tabs, menus). With a session it reads behind the login, as the user it was
signed in as. The screens are the input for building components.

```bash
# a public site, every page in its sitemap
npx equipe-design extract --crawl https://equipe.im/ --max-pages 0

# a service you are signed in to: a Playwright storageState file your agent saved…
npx equipe-design extract --crawl https://app.example.com/ --session ~/secrets/app-state.json

# …or the browser your agent is signed in with (Chrome started with --remote-debugging-port)
npx equipe-design extract --crawl https://app.example.com/ --cdp http://127.0.0.1:9222
```

```json
{ "urls": ["https://app.example.com/"], "outDir": "out/app", "crawl": true, "session": "app-state.json", "maxPages": 80 }
```

## Options

The CLI and the MCP tool are built from one table (`packages/engine/src/crawl/options.ts`), so
they take the same options with the same defaults and checks.

| CLI | MCP | Default | What |
|---|---|---|---|
| `--session FILE` | `session` | — | Playwright storageState of a signed-in session |
| `--cdp URL` | `cdp` | — | Address of a browser the user's agent signed in with |
| `--max-pages N` | `maxPages` | 60 | Screens to read at most; 0 = no cap |
| `--delay MS` | `delayMs` | 1500 | Pause between page loads, at least 500 |
| `--per-pattern N` | `perPattern` | 3 | URLs of one shape to read |
| `--reveal N` | `reveal` | 6 | Menus, dialogs, dropdowns, tabs to open per screen; 0 = none |
| `--widths` | `widths` | 1440,390 | Widths for sweeps and screenshots |
| `--modes` | `modes` | auto | Light, and dark when the site has it |

Why these defaults:

- **60 screens.** A screen takes about 8–15 s (two widths × two modes, four screenshots, its
  menus; measured 2026-11-04: 9 s a screen on equipe.im, 10.5 s on a local Gitea). 60 is about 10–15 minutes. Together with three URLs per
  shape that covers the distinct templates of a typical app — dashboard, lists, details, settings
  sections — and more pages mostly repeat templates already read. Raise it, or use 0, for big apps.
- **1.5 s between page loads**, on top of the page's own load and the 8–15 s of reading, keeps a
  crawl well under one page load every 5 s. It can't go below 0.5 s.
- **Three per shape.** `/project/123` and `/project/456` have one shape, `/project/:id`. Three
  show a template's variants (an empty and a full list, a long title) without reading every
  project. Shapes: numbers, UUIDs, hashes, long opaque ids, `slug-123` and dates become `:id`;
  query values are dropped (`/issues?state=open&page=2` → `/issues?page&state`).
- **New shapes first.** Another example of a shape already read, and the same path with other
  parameters (filter tabs, sorting, paging), wait until every new screen found so far is read.
  Within that: the app's navigation first, then the sitemap, then other links.

## Signing in

The crawl never sees or asks for a password. The user's own agent signs in with the user's own
account, then hands over the result:

- **`--session`**: a storageState file (Playwright's `context.storageState({ path })`).
- **`--cdp`**: the browser is reached once, over its DevTools address, to copy the session; the
  crawl itself runs in its own headless browser. No tab is opened, navigated or closed in that
  browser, and it keeps running.

Either way only the crawled site's cookies (its host and parent domains) and its own origin's
localStorage are kept; every other site's sign-in is dropped (`session.droppedCookies` counts
them). Nothing of the session is written to the result. Signing in, and what the account may be
used for under the service's terms, is the user's responsibility.

If the first screen is a login screen the crawl stops with exit code 2 (`login-required`); if
three screens in a row turn into the login screen, the session is taken as ended and it stops.

## Reading only

A crawl must not change anything in the account. Each rule below is a separate layer, so a
mistake in one is caught by the next.

1. **Network: GET and HEAD only.** Every other method (POST, PUT, PATCH, DELETE…) is aborted in
   the browser before it leaves — the page's own scripts included (analytics posts, beacons,
   auto-saves). `guardrails.nonGetBlocked` counts them, `blocked` lists them.
2. **No WebSockets.** A socket never reaches the server: what a page sends over one can't be
   told apart from an action. `guardrails.webSocketsBlocked` counts them. Pages that need a
   socket to draw may look emptier.
3. **No forms.** Nothing is typed (`keystrokes: 0`), nothing is submitted (`formsSubmitted: 0`),
   no Enter is pressed. Even GET forms (search) are not sent.
4. **Links are opened by their address, never clicked**, so no script attached to them runs.
   A link is not followed when:
   - its address names an action: `logout`, `signout`, `delete`, `remove`, `destroy`, `billing`,
     `checkout`, `pay`, `subscribe`, `invite`, `leave`, `transfer`, `revoke`, `reset`, `archive`,
     `approve`, `merge`, `publish`, `deploy`, `send`, `confirm`, `star`, `follow`, `watch`, `like`,
     `download`, `export`… (whole words of the path), or a parameter does (`?action=delete`,
     `?do=…`, `?_method=DELETE`);
   - its name names one: "Log out", "Delete account", "Invite people", "Pay", and the same in
     Korean, Japanese, Chinese, German, French, Spanish and Portuguese ("로그아웃", "삭제",
     "결제", "초대", "저장"…). The address is then never opened, whichever link leads to it;
   - a script turns it into a request: `data-method`/`data-turbo-method` other than GET,
     `data-confirm`, `data-remote`, `hx-post|put|patch|delete`, `ping`;
   - it is a sign-in, sign-up, password or two-factor screen (`/login`, `/session`, `/oauth`…),
     which could end the session or start a new one;
   - it is a file or feed (`.zip`, `.pdf`, `/raw/`, `/rss`, `/api/`…), or on another origin.
5. **GETs that act are aborted too.** Page and fetch requests to the site whose address names an
   action (rule 4) are aborted in the browser, so a redirect or a script can't reach `/logout`.
6. **Only disclosure controls are pressed** to open hidden UI: `aria-haspopup`,
   `aria-expanded="false"`, `<summary>`, `role="tab"`, dropdown toggles. Never a submit button,
   a button in a form without `type="button"`, a link that would navigate, a control wired to a
   request (`hx-*`, `data-method`, `formaction`…), or anything whose name is an action — the
   full word list here also has "save", "submit", "apply", "update", "create", "new", "edit",
   "close", "send", "confirm". While a control is pressed, page navigations are aborted, and the
   control is checked to still be the one it was before it is pressed.
7. **Dialogs are cancelled.** `confirm()` and `prompt()` are answered "cancel".
8. **No downloads, no service workers, no permissions.** The browser context refuses them.
9. **robots.txt** is read and obeyed for every address, as in `extract`.

Everything left alone is in `crawl.json` → `skipped` with the rule that hit (`action-link`,
`action-control`, `auth-page`, `not-a-screen`, `robots`, `same-pattern`, `over-cap`,
`off-site`, `login-wall`) and in `crawl.md`.

These rules are names and patterns, not an understanding of the app: a control that acts but is
named like anything else ("Go", an icon without a label) would only be stopped by rules 1–3 if
it is pressed. That is why only disclosure controls are pressed at all.

## What a crawl writes

```
crawl.json                     run, session summary (no values), found, guardrails, screens, skipped, blocked
crawl.md                       the same for people
screens/NNN/styles.json        the engine's input for the screen: light/dark sweeps at each width, variables, states
screens/NNN/<width>-<mode>.jpg full-page screenshots, at most 8000 px tall
screens/NNN/reveal-KK.jpg      a menu/dialog/dropdown opened on that screen (viewport)
screens/NNN/reveal-KK.json     its sweep, same format as one sweep in styles.json
```

The folder holds screenshots of the signed-in account: keep it where only the account's owner
can see it. Unlike `extract.json`, a crawl folder keeps screenshots and page titles, because the
component step needs to see the screens.
