import { buildRegistry } from "./lib.mjs"

const count = await buildRegistry()
console.log(`Built ${count} registry items and all.json.`)
