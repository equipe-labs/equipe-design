# equipe registry

This package pins the 2026-11-08 shadcn All Components catalog and builds the
URL-installable equipe registry.

## Add or implement an item

Work only in `items/<name>/`:

- `registry.json` owns the shadcn item, source files, dependencies, and
  provenance.
- `docs.json` owns examples, variants and sizes, states, usage, keyboard and
  accessibility notes, and source/license documentation.

Do not edit the root `registry.json` or files under `registry/`; `npm run build`
regenerates them deterministically by scanning item folders. Missing or duplicate
snapshot items, file collisions, incomplete docs, and incomplete provenance fail
the build. NPM dependencies must use exact versions; the fixture blocks lifecycle
scripts while the CLI installs an item.

Internal `registryDependencies` are declared by item name. The build recursively
flattens those equipe dependencies into each generated URL item, so a URL install
never falls through to the official shadcn registry. Cycles and target collisions
fail before output is written.

## Commands

```sh
npm run build -w @equipe-design/registry
npm run check -w @equipe-design/registry
npm run check:upstream -w @equipe-design/registry
npm run test:install -w @equipe-design/registry -- button all
npm run test:install:all -w @equipe-design/registry
```

The install harness serves the generated JSON on a local HTTP URL and invokes
the pinned standard CLI (`npx --no-install shadcn add <URL>`) in a clean
React + Tailwind v4 + Vite fixture. It then runs TypeScript and a production
build after every requested item.
