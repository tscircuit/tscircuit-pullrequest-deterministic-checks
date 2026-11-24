import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const candidatePath = "src/pcb/pcb_differential_pair_phase_skew.ts"
const sharedPath = "src/common/point.ts"
const sharedPoint = [
  'import { z } from "zod"',
  'import { distance } from "../units"',
  "export const point = z.object({ x: distance, y: distance })",
  "export interface Point { x: number; y: number }",
].join("\n")

function check(params: {
  content: string
  repoFullName?: string
  diffText?: string
}) {
  return runChecks(
    createMemorySource({
      repoFullName: params.repoFullName ?? "tscircuit/circuit-json",
      files: {
        [sharedPath]: sharedPoint,
        [candidatePath]: params.content,
      },
      diffText: params.diffText ?? addedFileDiff(candidatePath, params.content),
    }),
    { groups: ["diff"], checkIdPrefixes: ["schema/redeclared-shared-shape"] },
  )
}

test("suggests shared point for the duplicate schema from Circuit JSON #1051", async () => {
  const content = [
    'import { z } from "zod"',
    "const finite_point = z.object({",
    "  y: z.number().finite(),",
    "  x: z.number().finite(),",
    "})",
  ].join("\n")
  const report = await check({ content })
  expect(report.errorCount).toBe(0)
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0]).toMatchObject({
    level: "warn",
    line: 2,
    filePath: candidatePath,
    message:
      "finite_point has the same output field shape as point (src/common/point.ts:3). Consider reusing it; verify input and validation constraints.",
  })
})

test("suggests the shared TypeScript type independently of its Zod schema", async () => {
  const report = await check({
    content: "type LocalPoint = { y: number; x: number }",
  })
  expect(report.findings).toHaveLength(1)
  expect(report.findings[0]?.message).toContain("Point (src/common/point.ts:4)")
})

test("skips different types, optional properties and unknown Zod transforms", async () => {
  const report = await check({
    content: [
      'import { z } from "zod"',
      "type Different = { x: string; y: number }",
      "interface PartialPoint { x: number; y?: number }",
      "const transformed = z.object({ x: z.number().transform(String), y: z.number() })",
      "const fromAnotherLibrary = other.object({ x: z.number(), y: z.number() })",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("only reports declarations touched by the diff", async () => {
  const report = await check({
    content: "type OldPoint = { x: number; y: number }\nexport const color = 1",
    diffText: [
      "diff --git a/" + candidatePath + " b/" + candidatePath,
      "--- a/" + candidatePath,
      "+++ b/" + candidatePath,
      "@@ -1 +1,2 @@",
      " type OldPoint = { x: number; y: number }",
      "+export const color = 1",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("only runs in Circuit JSON and accepts direct reuse", async () => {
  const otherRepo = await check({
    repoFullName: "tscircuit/core",
    content: "type LocalPoint = { x: number; y: number }",
  })
  const reused = await check({
    content: 'import { point } from "src/common"\nexport const start = point',
  })
  expect(otherRepo.findings).toEqual([])
  expect(reused.findings).toEqual([])
})
