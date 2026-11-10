import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { buildRegistry, loadSnapshot, packageRoot, repositoryRoot } from "./lib.mjs"

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)))
  })
}

function contentType(path) {
  return extname(path) === ".json" ? "application/json; charset=utf-8" : "application/octet-stream"
}

await buildRegistry({ check: true })
const snapshot = loadSnapshot()
const every = process.argv.includes("--every")
const requested = process.argv.slice(2).filter((arg) => arg !== "--every")
const items = every ? [...snapshot.items.map((item) => item.name), "all"] : (requested.length ? requested : ["button", "all"])
const allowed = new Set([...snapshot.items.map((item) => item.name), "all"])
for (const item of items) if (!allowed.has(item)) throw new Error(`unknown registry item: ${item}`)

const registryRoot = join(packageRoot, "registry")
const server = createServer(async (request, response) => {
  try {
    const name = new URL(request.url, "http://localhost").pathname.replace(/^\//, "")
    if (!/^[a-z0-9-]+\.json$/.test(name)) throw new Error("not found")
    const path = join(registryRoot, name)
    await stat(path)
    response.writeHead(200, { "content-type": contentType(path) })
    response.end(await readFile(path))
  } catch {
    response.writeHead(404).end("not found")
  }
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
const baseUrl = `http://127.0.0.1:${address.port}`
const scratch = await mkdtemp(join(tmpdir(), "equipe-registry-fixture-"))
const fixtureSource = join(packageRoot, "fixture")

try {
  await cp(fixtureSource, scratch, { recursive: true })
  await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: scratch })
  for (const item of items) {
    console.log(`\n=== clean fixture: ${item} ===`)
    for (const path of ["components", "hooks", "lib"]) await rm(join(scratch, "src", path), { recursive: true, force: true })
    await cp(join(fixtureSource, "package.json"), join(scratch, "package.json"))
    await cp(join(fixtureSource, "package-lock.json"), join(scratch, "package-lock.json"))
    await cp(join(fixtureSource, "components.json"), join(scratch, "components.json"))
    await cp(join(fixtureSource, "src"), join(scratch, "src"), { recursive: true, force: true })
    const url = `${baseUrl}/${item}.json`
    await run("npx", ["--no-install", "shadcn", "add", url, "--yes", "--overwrite", "--cwd", scratch], {
      cwd: repositoryRoot,
      env: { ...process.env, npm_config_ignore_scripts: "true" },
    })
    await run("npm", ["run", "typecheck"], { cwd: scratch })
    await run("npm", ["run", "build"], { cwd: scratch })
  }
  console.log(`\nInstalled, typechecked, and production-built ${items.length} clean fixture target(s).`)
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await rm(scratch, { recursive: true, force: true })
}
