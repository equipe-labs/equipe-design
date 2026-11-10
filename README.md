# equipe-design

Extract design tokens from sites you like, remix them into your own brand, and export a design system you can ship:
DTCG tokens, CSS variables, Tailwind v4 `@theme`, shadcn theme, Swift, Kotlin, Figma variables — with contrast guardrails.

Values only: no logos, images, font files or copied CSS. You pick the references; the output is yours, renamed and re-toned to your brand.

Status: early. The extraction engine works; remix and exporters are being built.

## Try it

```bash
npm install                                   # once, in this repository (needs Google Chrome installed)
npx equipe-design extract https://equipe.im   # → equipe-design/<host>-<time>/extract.json + report.md
npx equipe-design report equipe-design/*/extract.json   # print the evidence and limits report again
```

`report.md` is the page to read first: roles with their light/dark pair, the brand colour verdict, components and states, and what could not be seen. Exit code 2 means a guardrail stopped the run (robots.txt, a login wall, a bot check).

## Crawl a whole service, signed in

```bash
npx equipe-design extract --crawl https://equipe.im/ --max-pages 0            # every page of a public site
npx equipe-design extract --crawl https://app.example.com/ --session state.json   # behind your login
```

Reads every screen it can find — sitemap, same-origin links, the app's own navigation — and keeps, per screen,
light/dark computed styles (the engine's input), screenshots at 1440 and 390 px, and the menus, dialogs and dropdowns
it could open. Reading only: GET/HEAD, no forms, and nothing that logs out, deletes, pays, invites or saves is
followed or pressed (each one is listed as skipped). Your session comes from your own agent, as a Playwright
storageState file or the address of the browser it signed in with — never a password.
Options, defaults and every read-only rule: [docs/crawl.md](docs/crawl.md). MCP agents: `design_extract` with `crawl: true`.

## Style library (coming soon)

A library of ready styles to pick and remix is planned but not available yet: the `library` command and the
`design_library_*` MCP tools have no public server to talk to for now (`https://equipe.im/api/design/v1` answers 404).
They work against a local server (`EQUIPE_DESIGN_API`) for development — see [docs/library-api.md](docs/library-api.md).

## Intended use

- **For**: analysing your own sites and the services you use, learning how a design system is put together, and turning what you see into a design system of your own — shadcn-level components included.
- **Not for**: reproducing someone else's brand. Brand colours are re-toned to yours by default, token names are neutral, and `extract.json` never holds logos, images, icons, font files, page text or CSS source.
- **Signing in is yours**: a crawl reads behind a login only with a session you hand it from your own agent and your own account. Whether that account may be used this way under the service's terms is your responsibility. The tool never asks for or stores a password, keeps only that site's cookies, and writes no session value to its results.
- **Guardrails**:
  - `extract` reads at most five pages, never logs in, and identifies itself in its User-Agent.
  - `extract --crawl` follows the sitemap and links on one origin, up to `--max-pages` (60 by default), at least 0.5 s apart (1.5 s by default), and reads only a few URLs of each shape.
  - Both only read: GET/HEAD requests only, no form is filled or sent, and links and buttons that would log out, delete, pay, invite or save settings are never followed or pressed — they are listed in the result. All rules: [docs/crawl.md](docs/crawl.md#reading-only).
  - Both respect `robots.txt`, stop at bot checks and never work around them.
  - A crawl folder holds screenshots of the signed-in account: keep it private.
- **Not legal advice.** The software is provided "as is", without warranty — see [LICENSE](LICENSE).

To report a misuse or a problem with a result, open an issue.

## Packages

| Folder | Package | What it is |
|---|---|---|
| `packages/schema` | `@equipe-design/schema` | JSON Schema for `extract.json` (schema 0.1), its TypeScript types, a validator, and three example results |
| `packages/engine` | `@equipe-design/engine` | The extraction engine: `extract()`, `crawl()` and `report()`. See [its README](packages/engine/README.md) |
| `packages/cli` | `equipe-design` | The `equipe-design` command. Every file in `src/commands/` is a command and registers itself |
| `packages/client` | `@equipe-design/client` | Client for the design library API (coming soon, [docs/library-api.md](docs/library-api.md)), and local pull/remix of library styles |
| `packages/mcp` | `@equipe-design/mcp` | MCP server `design` (stdio). Every file in `src/tools/` is a tool and registers itself |

## Development

Node 22.18 or later (TypeScript runs as is, with Node's type stripping).

```bash
npm install
npm test             # vitest: examples against the schema, forbidden-content checks, CLI
npm run lint         # tsc, generated types up to date, eslint
npx equipe-design --help
```

The schema is the single source: after editing `packages/schema/extract-0.2.schema.json`, run `npm run gen:types`.

## License

[Apache-2.0](LICENSE)
