import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { registryItemSchema } from "shadcn/schema"

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const repositoryRoot = resolve(packageRoot, "../..")
export const expectedComponentCount = 66

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertStrings(value, label) {
  assert(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`)
  for (const entry of value) assert(typeof entry === "string" && entry.trim(), `${label} has an empty entry`)
}

export function loadSnapshot() {
  const snapshot = readJson(join(packageRoot, "official-components.json"))
  assert(snapshot.capturedAt === "2026-11-08", "official snapshot date must stay pinned to 2026-11-08")
  assert(snapshot.count === expectedComponentCount, `official snapshot count must be ${expectedComponentCount}`)
  assert(Array.isArray(snapshot.items), "official snapshot items must be an array")
  assert(snapshot.items.length === expectedComponentCount, `official snapshot must contain ${expectedComponentCount} items`)
  const names = snapshot.items.map((item) => item.name)
  assert(new Set(names).size === names.length, "official snapshot contains duplicate names")
  for (const item of snapshot.items) {
    assert(typeof item.name === "string" && /^[a-z0-9-]+$/.test(item.name), `invalid snapshot name: ${item.name}`)
    assert(typeof item.title === "string" && item.title.trim(), `missing title for ${item.name}`)
    assert(typeof item.docsPath === "string" && item.docsPath.startsWith("/docs/components/base/"), `invalid docsPath for ${item.name}`)
  }
  return snapshot
}

function validateDocs(docs, name, provenance) {
  assert(docs && typeof docs === "object" && !Array.isArray(docs), `${name}: docs.json must be an object`)
  assert(docs.name === name, `${name}: docs name must match folder name`)
  assertStrings(docs.examples, `${name}: examples`)
  assertStrings(docs.variantsAndSizes, `${name}: variantsAndSizes`)
  assert(Array.isArray(docs.states) && docs.states.length > 0, `${name}: states must be non-empty`)
  for (const state of docs.states) {
    assert(typeof state?.name === "string" && state.name.trim(), `${name}: state name is required`)
    assert(typeof state?.expectation === "string" && state.expectation.trim(), `${name}: state expectation is required`)
  }
  assertStrings(docs.usage, `${name}: usage`)
  assertStrings(docs.keyboard, `${name}: keyboard`)
  assertStrings(docs.accessibility, `${name}: accessibility`)
  assert(docs.sourceAndLicense?.upstream === provenance.upstreamUrl, `${name}: docs upstream must match provenance`)
  assert(docs.sourceAndLicense?.revision === provenance.upstreamRevision, `${name}: docs revision must match provenance`)
  assert(docs.sourceAndLicense?.license === provenance.license.spdx, `${name}: docs license must match provenance`)
}

function validateProvenance(provenance, name) {
  assert(provenance && typeof provenance === "object", `${name}: meta.provenance is required`)
  assert(/^https:\/\//.test(provenance.upstreamUrl ?? ""), `${name}: provenance upstreamUrl is required`)
  assert(/^([0-9a-f]{40}|v?\d+\.\d+\.\d+)$/.test(provenance.upstreamRevision ?? ""), `${name}: provenance revision must be a full commit or version`)
  assert(typeof provenance.license?.spdx === "string" && provenance.license.spdx.trim(), `${name}: provenance license SPDX is required`)
  assert(typeof provenance.license?.file === "string" && provenance.license.file.trim(), `${name}: provenance license file is required`)
  assert(existsSync(resolve(packageRoot, provenance.license.file)), `${name}: license file does not exist: ${provenance.license.file}`)
  assert(typeof provenance.changeReason === "string" && provenance.changeReason.trim(), `${name}: changeReason is required`)
}

function validatePinnedPackages(packages, label) {
  for (const dependency of packages ?? []) {
    const separator = dependency.lastIndexOf("@")
    const version = separator > 0 ? dependency.slice(separator + 1) : ""
    assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version), `${label}: dependency must use an exact version: ${dependency}`)
  }
}

export function loadItems() {
  const snapshot = loadSnapshot()
  const itemRoot = join(packageRoot, "items")
  const folders = readdirSync(itemRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const expectedNames = snapshot.items.map((item) => item.name).sort()
  const missing = expectedNames.filter((name) => !folders.includes(name))
  const extra = folders.filter((name) => !expectedNames.includes(name))
  assert(missing.length === 0 && extra.length === 0, `item folders differ from snapshot; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`)

  const seen = new Set()
  const items = folders.map((folder) => {
    const folderRoot = join(itemRoot, folder)
    const sourceRegistry = readJson(join(folderRoot, "registry.json"))
    assert(sourceRegistry.$schema === "https://ui.shadcn.com/schema/registry.json", `${folder}: official shadcn registry schema is required`)
    assert(Array.isArray(sourceRegistry.items) && sourceRegistry.items.length === 1, `${folder}: registry.json must own exactly one item`)
    const item = sourceRegistry.items[0]
    const parsedItem = registryItemSchema.safeParse(item)
    assert(parsedItem.success, `${folder}: invalid shadcn item schema: ${parsedItem.error?.message ?? "unknown error"}`)
    assert(item.name === folder, `${folder}: item name must match folder name`)
    assert(!seen.has(item.name), `duplicate registry item: ${item.name}`)
    seen.add(item.name)
    const snapshotItem = snapshot.items.find((entry) => entry.name === item.name)
    const provenance = item.meta?.provenance
    validateProvenance(provenance, item.name)
    validatePinnedPackages(item.dependencies, `${item.name}: dependencies`)
    validatePinnedPackages(item.devDependencies, `${item.name}: devDependencies`)
    assert(provenance.upstreamUrl === new URL(snapshotItem.docsPath, snapshot.upstream.componentsPage).href, `${item.name}: upstream URL differs from official snapshot`)
    assert(provenance.upstreamRevision === snapshot.upstream.commit, `${item.name}: upstream revision differs from official snapshot`)
    validateDocs(readJson(join(folderRoot, "docs.json")), item.name, provenance)
    for (const file of item.files ?? []) {
      assert(existsSync(resolve(folderRoot, file.path)), `${item.name}: missing source file ${file.path}`)
    }
    return { folderRoot, item }
  })
  return { snapshot, items }
}

export function renderRootRegistry(items) {
  return `${JSON.stringify({
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: "equipe",
    homepage: "https://design.equipe.im",
    include: items.map(({ item }) => `items/${item.name}/registry.json`),
  }, null, 2)}\n`
}

function mergeBuiltItems(items, outputRoot) {
  const dependencies = new Set()
  const devDependencies = new Set()
  const files = new Map()
  const css = {}
  const cssVars = { theme: {}, light: {}, dark: {} }
  const internalNames = new Set(items.map(({ item }) => item.name))
  const externalRegistryDependencies = new Set()
  for (const { item } of items) {
    const built = readJson(join(outputRoot, `${item.name}.json`))
    for (const dependency of built.dependencies ?? []) dependencies.add(dependency)
    for (const dependency of built.devDependencies ?? []) devDependencies.add(dependency)
    for (const dependency of built.registryDependencies ?? []) {
      if (!internalNames.has(dependency)) externalRegistryDependencies.add(dependency)
    }
    for (const file of built.files ?? []) {
      const key = file.target ?? file.path
      const previous = files.get(key)
      assert(!previous || JSON.stringify(previous) === JSON.stringify(file), `all: file collision at ${key}`)
      files.set(key, file)
    }
    Object.assign(css, built.css ?? {})
    for (const section of ["theme", "light", "dark"]) Object.assign(cssVars[section], built.cssVars?.[section] ?? {})
  }
  const snapshot = loadSnapshot()
  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: "all",
    type: "registry:item",
    title: "All equipe components",
    description: `The pinned ${snapshot.capturedAt} set of ${snapshot.count} equipe registry components.`,
    dependencies: [...dependencies].sort(),
    devDependencies: [...devDependencies].sort(),
    registryDependencies: [...externalRegistryDependencies].sort(),
    files: [...files.values()].sort((a, b) => (a.target ?? a.path).localeCompare(b.target ?? b.path)),
    css,
    cssVars,
    meta: {
      components: items.map(({ item }) => item.name),
      provenance: {
        upstreamUrl: snapshot.upstream.componentsPage,
        upstreamRevision: snapshot.upstream.commit,
        license: { spdx: "MIT", file: "LICENSES/shadcn-ui-MIT.txt" },
        changeReason: "Aggregate URL item for one-command installation and boundary fixture testing.",
      },
    },
  }
}

function flattenBuiltItems(items, outputRoot) {
  const internalNames = new Set(items.map(({ item }) => item.name))
  const raw = new Map(items.map(({ item }) => [item.name, readJson(join(outputRoot, `${item.name}.json`))]))
  const resolved = new Map()

  function resolveItem(name, ancestry = []) {
    if (resolved.has(name)) return resolved.get(name)
    assert(!ancestry.includes(name), `registry dependency cycle: ${[...ancestry, name].join(" -> ")}`)
    const own = raw.get(name)
    assert(own, `missing built registry dependency: ${name}`)
    const dependencyPayloads = []
    const externalRegistryDependencies = []
    for (const dependency of own.registryDependencies ?? []) {
      if (internalNames.has(dependency)) dependencyPayloads.push(resolveItem(dependency, [...ancestry, name]))
      else externalRegistryDependencies.push(dependency)
    }

    const packageDependencies = new Set()
    const devDependencies = new Set()
    const registryDependencies = new Set(externalRegistryDependencies)
    const files = new Map()
    const css = {}
    const cssVars = { theme: {}, light: {}, dark: {} }
    for (const payload of [...dependencyPayloads, own]) {
      for (const dependency of payload.dependencies ?? []) packageDependencies.add(dependency)
      for (const dependency of payload.devDependencies ?? []) devDependencies.add(dependency)
      if (payload !== own) for (const dependency of payload.registryDependencies ?? []) registryDependencies.add(dependency)
      for (const file of payload.files ?? []) {
        const key = file.target ?? file.path
        const previous = files.get(key)
        assert(!previous || JSON.stringify(previous) === JSON.stringify(file), `${name}: dependency file collision at ${key}`)
        files.set(key, file)
      }
      Object.assign(css, payload.css ?? {})
      for (const section of ["theme", "light", "dark"]) Object.assign(cssVars[section], payload.cssVars?.[section] ?? {})
    }
    const flattened = {
      ...own,
      dependencies: [...packageDependencies].sort(),
      devDependencies: [...devDependencies].sort(),
      registryDependencies: [...registryDependencies].sort(),
      files: [...files.values()].sort((a, b) => (a.target ?? a.path).localeCompare(b.target ?? b.path)),
      css,
      cssVars,
    }
    resolved.set(name, flattened)
    return flattened
  }

  for (const { item } of items) {
    writeFileSync(join(outputRoot, `${item.name}.json`), `${JSON.stringify(resolveItem(item.name), null, 2)}\n`)
  }
}

function runShadcnBuild(outputRoot) {
  execFileSync("npx", ["--no-install", "shadcn", "build", "registry.json", "--output", outputRoot, "--cwd", packageRoot], {
    cwd: repositoryRoot,
    stdio: "inherit",
  })
}

export async function buildRegistry({ check = false } = {}) {
  const { items } = loadItems()
  const rootContent = renderRootRegistry(items)
  const rootPath = join(packageRoot, "registry.json")
  if (!check) writeFileSync(rootPath, rootContent)
  else assert(readFileSync(rootPath, "utf8") === rootContent, "registry.json is stale; run the registry build")

  const outputRoot = check ? await mkdtemp(join(tmpdir(), "equipe-registry-check-")) : join(packageRoot, "registry")
  try {
    if (!check) await rm(outputRoot, { recursive: true, force: true })
    runShadcnBuild(outputRoot)
    flattenBuiltItems(items, outputRoot)
    const allContent = `${JSON.stringify(mergeBuiltItems(items, outputRoot), null, 2)}\n`
    if (!check) writeFileSync(join(outputRoot, "all.json"), allContent)
    else {
      const committedRoot = join(packageRoot, "registry")
      const expectedNames = [...items.map(({ item }) => `${item.name}.json`), "all.json"].sort()
      const actualNames = readdirSync(committedRoot).filter((name) => name.endsWith(".json") && name !== "registry.json").sort()
      assert(JSON.stringify(actualNames) === JSON.stringify(expectedNames), "generated registry file set is stale")
      for (const name of items.map(({ item }) => `${item.name}.json`)) {
        assert(await readFile(join(committedRoot, name), "utf8") === await readFile(join(outputRoot, name), "utf8"), `${name} is stale`)
      }
      assert(await readFile(join(committedRoot, "all.json"), "utf8") === allContent, "all.json is stale")
    }
  } finally {
    if (check) await rm(outputRoot, { recursive: true, force: true })
  }
  return items.length
}

export function relativeToPackage(path) {
  return relative(packageRoot, path)
}
