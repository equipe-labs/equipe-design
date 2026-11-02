# equipe-design

Extract design tokens from sites you like, remix them into your own brand, and export a design system you can ship:
DTCG tokens, CSS variables, Tailwind v4 `@theme`, shadcn theme, Swift, Kotlin, Figma variables — with contrast guardrails.

Values only: no logos, images, font files or copied CSS. You pick the references; the output is yours, renamed and re-toned to your brand.

Status: early. The repository skeleton and the extraction result schema 0.1 are in; the engine, remix and exporters are being built.

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
| `packages/cli` | `equipe-design` | The `equipe-design` command. Every file in `src/commands/` is a command and registers itself |
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
