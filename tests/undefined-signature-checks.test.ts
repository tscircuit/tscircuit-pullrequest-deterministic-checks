import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const path = "src/example.ts"
const checkId = "handbook/review-undefined-signature"
const reviewed = [
  "function getRouteLength({ length }: {",
  "  length: SourceBusRouteLength | undefined",
  "}): RouteLength | undefined { return undefined }",
].join("\n")

function check(params: { content: string; repo?: string; diffText?: string }) {
  return runChecks(
    createMemorySource({
      repoFullName: params.repo,
      files: { [path]: params.content },
      diffText: params.diffText ?? addedFileDiff(path, params.content),
    }),
    { groups: ["diff"], checkIdPrefixes: [checkId] },
  )
}

test("warns on both sides of the reviewed converter across repositories", async () => {
  for (const repo of [
    "tscircuit/core",
    "tscircuit/circuit-json",
    "somewhere/else",
  ]) {
    const report = await check({ content: reviewed, repo })
    expect(report.errorCount).toBe(0)
    expect(report.findings.map(({ line, level }) => [line, level])).toEqual([
      [2, "warn"],
      [3, "warn"],
    ])
    expect(report.findings[0]?.message).toContain("at the caller")
    expect(report.findings[1]?.message).toContain("lookup miss")
  }
})

test("recognizes promise results, direct undefined, and annotated arrows", async () => {
  const report = await check({
    content: [
      "async function lookup(): Promise<(string | undefined)> {}",
      "function missing(): undefined { return undefined }",
      "const parse = (token: string | undefined) => token",
    ].join("\n"),
  })
  expect(report.warnCount).toBe(3)
})

test("does not flag plain optional syntax, nested value types, inferred types, or stored fields", async () => {
  const report = await check({
    content: [
      "function greet(name?: string): void {}",
      "function read(items: (string | undefined)[]) { return items[0] }",
      "interface Stored { length: number | undefined }",
      "type Length = number | undefined",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("leaves pre-existing signatures alone when only a body line is added", async () => {
  const report = await check({
    content: "function lookup(): string | undefined {\n  return undefined\n}",
    diffText: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,2 +1,3 @@",
      " function lookup(): string | undefined {",
      "+  return undefined",
      " }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("anchors a multiline union to the added undefined line", async () => {
  const report = await check({
    content:
      "function lookup():\n  | string\n  | undefined { return undefined }",
    diffText: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,2 +1,3 @@",
      " function lookup():",
      "-  | string { return undefined }",
      "+  | string",
      "+  | undefined { return undefined }",
    ].join("\n"),
  })
  expect(report.findings.map(({ line }) => line)).toEqual([3])
})
