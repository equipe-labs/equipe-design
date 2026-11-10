import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { loadItems, loadSnapshot, packageRoot, renderRootRegistry } from "../scripts/lib.mjs"

describe("registry snapshot", () => {
  test("pins exactly 66 unique official component names", () => {
    const snapshot = loadSnapshot()
    expect(snapshot.items).toHaveLength(66)
    expect(new Set(snapshot.items.map((item) => item.name)).size).toBe(66)
  })

  test("item folders independently satisfy metadata, docs, and provenance", () => {
    const { items } = loadItems()
    expect(items).toHaveLength(66)
  })

  test("root manifest is derived only from item folders", async () => {
    const { items } = loadItems()
    expect(await readFile(join(packageRoot, "registry.json"), "utf8")).toBe(renderRootRegistry(items))
  })

  test("generated URL items are byte-current", () => {
    const result = spawnSync(process.execPath, [join(packageRoot, "scripts/check.mjs")], { encoding: "utf8" })
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  test("upstream checker reports additions and removals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "equipe-upstream-test-"))
    const source = join(directory, "components.html")
    await writeFile(source, '<a href="/docs/components/base/accordion">Accordion</a><a href="/docs/components/base/new-one">New</a>')
    const result = spawnSync(process.execPath, [join(packageRoot, "scripts/check-upstream.mjs"), "--source", source], { encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Added upstream: new-one")
    expect(result.stdout).toContain("Removed upstream:")
    expect(result.stdout).toContain("alert")
  })
})
