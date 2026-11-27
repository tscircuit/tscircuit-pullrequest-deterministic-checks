import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "tests/fixtures/memory-source"

const filePath = "lib/example.ts"
const checkId = "handbook/one-function-per-file"

function checkExample(code: string, diffText = addedFileDiff(filePath, code)) {
  return runChecks(
    createMemorySource({ files: { [filePath]: code }, diffText }),
    {
      checkIdPrefixes: [checkId],
    },
  )
}

test("reports one finding for a declaration and two functions on one variable statement", async () => {
  const { findings, errorCount } = await checkExample(
    "export function first() {}\nconst second = () => 2, third = function () { return 3 }",
  )
  expect(errorCount).toBe(1)
  expect(findings).toEqual([
    expect.objectContaining({
      checkId,
      filePath,
      line: 1,
      message: expect.stringContaining("3 top-level functions"),
    }),
  ])
})

test("ignores overload signatures, ambient declarations, class methods and callbacks", async () => {
  const { findings } = await checkExample(
    [
      "declare function ambient(): void",
      "function overloaded(n: number): number",
      "function overloaded(n: number) {",
      "  const nested = () => n",
      "  return [n].map(() => nested())[0]",
      "}",
      "class Example { method() {} }",
      "const wrapped = [1].map((n) => n)",
    ].join("\n"),
  )
  expect(findings).toEqual([])
})

test("counts wrapped arrows and a default export expression", async () => {
  const { findings } = await checkExample(
    "const helper = (() => 1) satisfies () => number\nexport default () => helper()",
  )
  expect(findings).toHaveLength(1)
})

test("flags a function inserted before an existing implementation", async () => {
  const { findings } = await checkExample(
    "const added = () => 1\nfunction existing() {}",
    [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -1 +1,2 @@",
      "+const added = () => 1",
      " function existing() {}",
    ].join("\n"),
  )
  expect(findings).toEqual([expect.objectContaining({ checkId, line: 1 })])
})

test("does not flag implementation-only edits to a file with existing functions", async () => {
  const { findings } = await checkExample(
    "function first() {\n  return 2\n}\nfunction second() {}",
    [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      "@@ -1,4 +1,4 @@",
      " function first() {",
      "-  return 1",
      "+  return 2",
      " }",
      " function second() {}",
    ].join("\n"),
  )
  expect(findings).toEqual([])
})
