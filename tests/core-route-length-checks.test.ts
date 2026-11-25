import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const filePath =
  "lib/components/primitive-components/Group/Subcircuit/inflators/inflateSourceBus.ts"
const checkId = "core/require-route-length-input"
const reviewed = [
  "function getRouteLength({ sourceBusRouteLength }: {",
  "  sourceBusRouteLength: SourceBusRouteLength | undefined",
  "}): RouteLength | undefined { return undefined }",
].join("\n")

function check(params: {
  content: string
  repo?: string
  prRepo?: string
  diffText?: string
  path?: string
}) {
  const path = params.path ?? filePath
  return runChecks(
    createMemorySource({
      files: { [path]: params.content },
      diffText: params.diffText ?? addedFileDiff(path, params.content),
      repoFullName: params.repo ?? "tscircuit/core",
      pr: params.prRepo ? { repoFullName: params.prRepo } : undefined,
    }),
    { groups: ["diff"], checkIdPrefixes: [checkId] },
  )
}

test("flags the nullable converter input in Core #5888", async () => {
  const report = await check({ content: reviewed })
  expect(report.errorCount).toBe(1)
  expect(report.findings[0]).toMatchObject({ checkId, filePath, line: 2 })
})

test("also checks optional parameters and inline fields", async () => {
  const report = await check({
    content: [
      "const convert = (length?: SourceBusRouteLength) => length",
      "const convertField = (input: { length?: SourceBusRouteLength }) => input",
    ].join("\n"),
  })
  expect(report.errorCount).toBe(2)
})

test("allows required inputs, optional return types and optional stored data", async () => {
  const report = await check({
    content: [
      reviewed.replace(
        "SourceBusRouteLength | undefined",
        "SourceBusRouteLength",
      ),
      "interface Stored { minLength?: SourceBusRouteLength }",
      "function named(name: string | undefined) { return name }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("does not flag existing parameters when only the function body changes", async () => {
  const report = await check({
    content: reviewed.replace(
      "return undefined",
      "return convert(sourceBusRouteLength)",
    ),
    diffText: [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -1,3 +1,3 @@",
      ...reviewed
        .split("\n")
        .slice(0, 2)
        .map((line) => ` ${line}`),
      "-}): RouteLength | undefined { return undefined }",
      "+}): RouteLength | undefined { return convert(sourceBusRouteLength) }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("does not apply outside a Core inflator or when targeting another repository", async () => {
  expect(
    (await check({ content: reviewed, path: "lib/elsewhere.ts" })).findings,
  ).toEqual([])
  expect(
    (await check({ content: reviewed, repo: "tscircuit/circuit-json" }))
      .findings,
  ).toEqual([])
  expect(
    (await check({ content: reviewed, prRepo: "fork/core" })).findings,
  ).toEqual([])
  expect(
    (
      await check({
        content: reviewed,
        repo: "fork/core",
        prRepo: "tscircuit/Core",
      })
    ).errorCount,
  ).toBe(1)
})
