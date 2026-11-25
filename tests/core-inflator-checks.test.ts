import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const dir = "lib/components/primitive-components/Group/Subcircuit/inflators"
const path = `${dir}/inflateSourceBus.ts`
const checkId = "core/no-new-inflator-components"
const reviewedCode = "class InflatedSourceBus extends PrimitiveComponent {}"

function check(
  params: {
    content?: string
    filePath?: string
    diffText?: string
    repo?: string
    prRepo?: string
  } = {},
) {
  const {
    content = reviewedCode,
    filePath = path,
    diffText = addedFileDiff(filePath, content),
    repo = "tscircuit/core",
    prRepo,
  } = params
  return runChecks(
    createMemorySource({
      files: { [filePath]: content },
      diffText,
      repoFullName: repo,
      pr: prRepo ? { repoFullName: prRepo } : undefined,
    }),
    { groups: ["diff"], checkIdPrefixes: [checkId] },
  )
}

test("blocks the new inflator component from Core #5888", async () => {
  const report = await check()
  expect(report.errorCount).toBe(1)
  expect(report.findings[0]).toMatchObject({
    checkId,
    filePath: path,
    line: 1,
  })
  expect(report.findings[0]?.message).toContain("InflatedSourceBus")
})

test("recognizes an aliased base class on a separate line", async () => {
  const report = await check({
    content: [
      'import { PrimitiveComponent as Primitive } from "./PrimitiveComponent"',
      "class InflatedSourceBus",
      "  extends Primitive {}",
    ].join("\n"),
  })
  expect(report.errorCount).toBe(1)
})

test("allows the existing simulation class, data helpers and ordinary Core components", async () => {
  expect(
    (
      await check({
        content: "class InflatedSimulation extends PrimitiveComponent {}",
        filePath: `${dir}/inflateSimulation.ts`,
      })
    ).findings,
  ).toEqual([])
  expect(
    (await check({ content: "class Cache {}\nexport function inflate() {}" }))
      .findings,
  ).toEqual([])
  expect(
    (
      await check({
        filePath: "lib/components/primitive-components/Bus.ts",
      })
    ).findings,
  ).toEqual([])
})

test("ignores changes confined to an existing class body", async () => {
  const report = await check({
    content: "class Existing extends PrimitiveComponent {\n  value = 1\n}",
    diffText: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,2 +1,3 @@",
      " class Existing extends PrimitiveComponent {",
      "+  value = 1",
      " }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("does not run outside canonical Core and uses the PR target over a fork checkout", async () => {
  expect((await check({ repo: "tscircuit/circuit-json" })).findings).toEqual([])
  expect((await check({ repo: "someone/core" })).findings).toEqual([])
  expect(
    (await check({ repo: "tscircuit/core", prRepo: "someone/core" })).findings,
  ).toEqual([])
  expect(
    (await check({ repo: "someone/core", prRepo: "tscircuit/Core" }))
      .errorCount,
  ).toBe(1)
})
