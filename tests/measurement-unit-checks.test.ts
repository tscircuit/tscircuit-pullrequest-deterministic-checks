import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "./fixtures/memory-source"

const path = "src/pcb/pcb_differential_pair_phase_skew.ts"
const checkId = "schema/missing-measurement-unit"

function check(params: {
  content: string
  diffText?: string
  repoFullName?: string
  prRepo?: string
}) {
  return runChecks(
    createMemorySource({
      repoFullName: params.repoFullName ?? "tscircuit/circuit-json",
      pr: params.prRepo ? { repoFullName: params.prRepo } : undefined,
      files: { [path]: params.content },
      diffText: params.diffText ?? addedFileDiff(path, params.content),
    }),
    { groups: ["diff"], checkIdPrefixes: [checkId] },
  )
}

test("warns on both original skew fields, without assuming a time unit", async () => {
  const report = await check({
    content: [
      'import { z } from "zod"',
      "export const segment = z.object({",
      "  width: z.number().positive().finite(),",
      "  start_phase_skew: z.number().finite(),",
      "  end_phase_skew: z.number().finite(),",
      "})",
    ].join("\n"),
  })
  expect(report.errorCount).toBe(0)
  expect(report.findings.map(({ line, level }) => [line, level])).toEqual([
    [4, "warn"],
    [5, "warn"],
  ])
  expect(report.findings[1]?.message).toContain(
    "length skew in mm and time skew in ps are different quantities",
  )
})

test("accepts unit suffixes and avoids non-numeric or non-schema fields", async () => {
  const report = await check({
    content: [
      'import { z } from "zod"',
      "const schema = z.object({",
      "  start_length_difference_mm: z.number().finite(),",
      "  end_phase_skew_ps: z.number(),",
      "  skew_kind: z.number(),",
      "  reported_skew: z.string(),",
      "  transformed_skew: z.number().transform(String),",
      "})",
      "const debug = { skew: 42 }",
      "const other = fake.object({ delay: z.number() })",
      "interface Named { signalVoltageMv: number; frequency_hz?: number }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("recognizes numeric TypeScript properties and renamed Zod imports", async () => {
  const report = await check({
    content: [
      'import { z as schema } from "zod"',
      'const timing = schema.object({ "edge_delay": schema.number().optional() })',
      "interface Result { signalVoltage?: number }",
    ].join("\n"),
  })
  expect(report.findings.map(({ line }) => line)).toEqual([2, 3])
})

test("does not report unchanged field names", async () => {
  const report = await check({
    content: "interface Old { skew: number }\ninterface New { count: number }",
    diffText: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1,2 @@",
      " interface Old { skew: number }",
      "+interface New { count: number }",
    ].join("\n"),
  })
  expect(report.findings).toEqual([])
})

test("uses the PR target when available and does not warn in other repositories", async () => {
  const content = "type Measurement = { skew: number }"
  expect(
    (await check({ content, repoFullName: "tscircuit/core" })).findings,
  ).toEqual([])
  expect(
    (
      await check({
        content,
        repoFullName: "user/circuit-json",
        prRepo: "tscircuit/Circuit-JSON",
      })
    ).findings,
  ).toHaveLength(1)
})
