import { readFile } from "node:fs/promises"
import { loadSnapshot } from "./lib.mjs"

const snapshot = loadSnapshot()
const sourceFlag = process.argv.indexOf("--source")
const html = sourceFlag >= 0
  ? await readFile(process.argv[sourceFlag + 1], "utf8")
  : await globalThis.fetch(snapshot.upstream.componentsPage).then((response) => {
      if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`)
      return response.text()
    })

const docsPaths = [...html.matchAll(/href=["'](\/docs\/components\/base\/([a-z0-9-]+))[^"']*["']/g)]
  .map((match) => ({ docsPath: match[1], slug: match[2] }))
const uniquePaths = [...new Map(docsPaths.map((entry) => [entry.docsPath, entry])).values()]
const aliases = new Map([["bubble", "bubble-button"]])
const upstream = new Set(uniquePaths.map(({ slug }) => aliases.get(slug) ?? slug))
const expected = new Set(snapshot.items.map((item) => item.name))
const added = [...upstream].filter((name) => !expected.has(name)).sort()
const removed = [...expected].filter((name) => !upstream.has(name)).sort()

console.log(`Official All Components: snapshot=${expected.size}, upstream=${upstream.size}`)
console.log(`Added upstream: ${added.length ? added.join(", ") : "none"}`)
console.log(`Removed upstream: ${removed.length ? removed.join(", ") : "none"}`)
if (added.length || removed.length) process.exitCode = 1
