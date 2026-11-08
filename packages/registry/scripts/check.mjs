import { buildRegistry } from "./lib.mjs"

const count = await buildRegistry({ check: true })
console.log(`Validated ${count} registry items, documentation records, provenance records, and generated files.`)
