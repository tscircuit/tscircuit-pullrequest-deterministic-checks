import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const filePath = "src/example.ts"
const checkId = "correctness/possible-division-by-zero"

test("warns on added zero-capable divisors but respects guards on the same const", async () => {
  for (const { expression, warnings } of [
    { expression: "return 4 / distance(start, end)", warnings: 1 },
    { expression: "return 4 / Math.hypot(dx, dy)", warnings: 1 },
    { expression: "return 4 / xs.length", warnings: 1 },
    { expression: "return 4 / items.size", warnings: 1 },
    { expression: "return 4 / (-0)", warnings: 1 },
    {
      expression: "const zero = 0x0; return 4 / (zero as number)",
      warnings: 1,
    },
    { expression: "let out = 4; out /= xs.length; return out", warnings: 1 },
    {
      expression: "const d = xs.length; const n = d; return 4 / n",
      warnings: 1,
    },
    { expression: "const d = 4; return 4 / d", warnings: 0 },
    { expression: 'return "4 / xs.length" // 4 / 0', warnings: 0 },
    {
      expression: "const d = distance(start, end); if (d > 0) { return 4 / d }",
      warnings: 0,
    },
    {
      expression:
        "const d = xs.length; if (d === 0) { return null } else { return 4 / d }",
      warnings: 0,
    },
    {
      expression: "const d = xs.length; return d === 0 ? null : 4 / d",
      warnings: 0,
    },
    { expression: "const d = xs.length; return d !== 0 && 4 / d", warnings: 0 },
    {
      expression: "const d = xs.length; if (0 >= d) return; return 4 / d",
      warnings: 0,
    },
    {
      expression:
        "const d = xs.length; for (;;) { if (d === 0) continue; return 4 / d }",
      warnings: 0,
    },
    {
      expression:
        "const d = Math.hypot(dx, dy); for (;;) { if (d <= 0 || d <= 1e-9) continue; return 4 / d }",
      warnings: 0,
    },
    {
      expression:
        "const d = distance(start, end); if (d > 0 && isReady) { return 4 / d }",
      warnings: 0,
    },
    {
      expression: "const d = xs.length; if (!d) return null; return 4 / d",
      warnings: 0,
    },
    {
      expression:
        "const d = xs.length; if (!(d > 0)) return null; return 4 / d",
      warnings: 0,
    },
    {
      expression: "const d = xs.length; if (d >= 0) return 4 / d",
      warnings: 1,
    },
    {
      expression: "const d = xs.length; if (d === 0) return 4 / d",
      warnings: 1,
    },
    {
      expression: "const d = xs.length; if (d !== 0) return; return 4 / d",
      warnings: 1,
    },
    {
      expression:
        "const d = xs.length; if (d > 0) { const d = 0; return 4 / d }",
      warnings: 1,
    },
    {
      expression:
        "const d = xs.length; if (d === 0) continueLabel(); return 4 / d",
      warnings: 1,
    },
    {
      expression: "const d = xs.length; const n = 4; if (n > 0) return 4 / d",
      warnings: 1,
    },
    {
      expression:
        "const d = xs.length; if (d === 0 && otherCheck) return null; return 4 / d",
      warnings: 1,
    },
    {
      expression:
        "const d = xs.length; if (d > 0 || otherCheck) return 4 / d; return 0",
      warnings: 1,
    },
    {
      expression: "const d = xs.length; if (!d) return 4 / d; return 0",
      warnings: 1,
    },
  ]) {
    const content = `function compute() {\n  ${expression}\n}`
    const report = await runChecks(
      createMemorySource({
        files: { [filePath]: content },
        diffText: addedFileDiff(filePath, content),
      }),
      { groups: ["diff"], checkIdPrefixes: [checkId] },
    )
    expect(report.errorCount).toBe(0)
    expect(report.findings.map(({ line, level }) => [line, level])).toEqual(
      Array.from({ length: warnings }, () => [2, "warn"]),
    )
  }

  const content = "const ratio = 4 / xs.length\nconst name = 2\n"
  const partial = await runChecks(
    createMemorySource({
      files: { [filePath]: content },
      diffText: [
        `diff --git a/${filePath} b/${filePath}`,
        `--- a/${filePath}`,
        `+++ b/${filePath}`,
        "@@ -1,1 +1,2 @@",
        " const ratio = 4 / xs.length",
        "+const name = 2",
      ].join("\n"),
    }),
    { groups: ["diff"], checkIdPrefixes: [checkId] },
  )
  expect(partial.findings).toEqual([])
})
