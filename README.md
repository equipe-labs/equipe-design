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

## Use a style from the library

Three steps: pick a style, make it your colour, take the code.

```bash
npx equipe-design library list                                  # 1. pick: styles, categories, brand colours, fonts
npx equipe-design library remix hush --brand "#0f766e"          # 2. your colour → design-library/hush-remix/a|b|c
npx equipe-design library pull design-library/hush-remix/a --to css,tailwind,shadcn,swift,kotlin   # 3. the code
```

- `remix` runs on your machine from the style's DTCG tokens; nothing is sent but GET requests. Each variant gets
  `tokens/*.json`, `tokens.css`, `remix.json` and a review picture `sheet.png` (needs Google Chrome). Contrast is checked to AA.
- `library show hush` prints one style; `library pull hush --to dtcg,css` takes the style as it is.
- The library lives at `https://equipe.im/api/design/v1`; set `EQUIPE_DESIGN_API` to use another address (a local server).
- MCP agents get the same as `design_library_search`, `design_library_get` and `design_library_pull` (with `brand` to remix).

## Intended use

- **For**: analysing your own sites, learning how a design system is put together, and inspiration for your own.
- **Not for**: reproducing someone else's brand. Brand colours are re-toned to yours by default, token names are neutral, and logos, images, icons, font files, page text and CSS source are never collected.
- **Your responsibility**: following the terms of the sites you read. The tool respects `robots.txt`, identifies itself in its User-Agent, reads at most five pages per run, never logs in and never works around bot checks.
- **Not legal advice.** The software is provided "as is", without warranty — see [LICENSE](LICENSE).

To report a misuse or a problem with a result, open an issue.

## Packages

| Folder | Package | What it is |
|---|---|---|
| `packages/schema` | `@equipe-design/schema` | JSON Schema for `extract.json` (schema 0.1), its TypeScript types, a validator, and three example results |
| `packages/engine` | `@equipe-design/engine` | The extraction engine: `extract()` and `report()`. See [its README](packages/engine/README.md) |
| `packages/cli` | `equipe-design` | The `equipe-design` command. Every file in `src/commands/` is a command and registers itself |
| `packages/client` | `@equipe-design/client` | Client for the design library API ([docs/library-api.md](docs/library-api.md)), and local pull/remix of library styles |
| `packages/mcp` | `@equipe-design/mcp` | MCP server `design` (stdio). Every file in `src/tools/` is a tool and registers itself |

## Development

Node 22.18 or later (TypeScript runs as is, with Node's type stripping).

```bash
npm install
npm test             # vitest: examples against the schema, forbidden-content checks, CLI
npm run lint         # tsc, generated types up to date, eslint
npx equipe-design --help
```

The schema is the single source: after editing `packages/schema/extract-0.1.schema.json`, run `npm run gen:types`.

## License

[Apache-2.0](LICENSE)
