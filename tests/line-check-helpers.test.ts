import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { getCodeOnly, isCommentLine } from "lib/utils/line-check-helpers"
import {
  addedFileDiff,
  createMemorySource,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("flags handbook violations inside template literal expressions", async () => {
  const code = [
    "export function renderSvg(box: unknown) {",
    "  const lookup = `${new Map<string, number>().size}`",
    '  return `<rect width="${(box as any).width}" data-count="${lookup}" />`',
    "}",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/render-svg.ts": code },
      diffText: addedFileDiff("lib/render-svg.ts", code),
    }),
  )
  const checkIds = report.findings.map((finding) => finding.checkId)
  expect(checkIds).toContain("handbook/map-string-key")
  expect(checkIds).toContain("handbook/no-as-any")
})

test("ignores nested backticks, inline block comments, JSDoc examples, and regex text", async () => {
  const code = [
    "/**",
    " * Example: const data = loadBoard() as any",
    " */",
    "export function formatMessage(ok: boolean, count: number) {",
    "  const nested = `${ok ? `inner` : `other`} text with as any and Map<string, number>`",
    "  const withObject = `${({ label: ok ? `a` : `b` }).label} as unknown`",
    "  const total = count /* treat legacy input as any or Map<string, number> */",
    "  const pattern = /\\bas\\s+any\\b|\\bMap<string,/",
    "  return `${nested}:${withObject}:${total}:${pattern.source}`",
    "}",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/format-message.ts": code },
      diffText: addedFileDiff("lib/format-message.ts", code),
    }),
  )
  expect(report.findings).toEqual([])
})

test("preserves code following regex literals with double slashes and leading inline comments", async () => {
  const code = [
    "export function parseUrl(rawUrl: unknown, fallback: unknown) {",
    "  const normalized = String(rawUrl).replace(/https?:\\/\\//, ''); const first = rawUrl as any",
    "  /* inline note */ const second = fallback as unknown",
    "  const ratio = 1",
    "    / (fallback as any) // multiline division still checks code",
    "  return [normalized, first, second, ratio]",
    "}",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/parse-url.ts": code },
      diffText: addedFileDiff("lib/parse-url.ts", code),
    }),
  )
  const asAnyLines = report.findings
    .filter((finding) => finding.checkId === "handbook/no-as-any")
    .map((finding) => finding.line)
  expect(asAnyLines).toEqual([2, 3, 5])
})

test("checks trailing inline comments for AI artifacts without matching code identifiers", async () => {
  const cleanCode = [
    "export function runModel(codexEndpoint: string) {",
    "  /* verified manually */ return codexEndpoint",
    "}",
  ].join("\n")
  const cleanReport = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/run-model.ts": cleanCode },
      diffText: addedFileDiff("lib/run-model.ts", cleanCode),
    }),
  )
  expect(cleanReport.findings).toEqual([])

  const trailingAiComment = [
    "export function sumPair(first: number, second: number) {",
    "  return first + second // " + "codex" + " review: checked overflow",
    "}",
  ].join("\n")
  const flaggedReport = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/sum-pair.ts": trailingAiComment },
      diffText: addedFileDiff("lib/sum-pair.ts", trailingAiComment),
    }),
  )
  expect(flaggedReport.findings.map((finding) => finding.checkId)).toContain(
    "comments/ai-artifacts",
  )
})

test("isCommentLine and getCodeOnly distinguish pure comments from mixed lines", () => {
  expect(isCommentLine("  // pure line comment")).toBe(true)
  expect(isCommentLine("  /* pure block comment */")).toBe(true)
  expect(isCommentLine("   * JSDoc continuation")).toBe(true)
  expect(isCommentLine("   */")).toBe(true)
  expect(isCommentLine("   ")).toBe(false)
  expect(isCommentLine("/* prefix */ const count = 1")).toBe(false)
  expect(isCommentLine("  */ const count = 1")).toBe(false)
  expect(getCodeOnly("  */ const bad = item as any")).toContain("as any")
})
