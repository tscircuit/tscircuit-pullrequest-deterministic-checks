import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import {
  addedFileDiff,
  createMemorySource,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("visual repo PR without an embedded image fails; with one it passes", async () => {
  const code = "export const x = 1"
  const diffText = addedFileDiff("lib/draw.ts", code)
  const files = { ...plopRepoFiles, "lib/draw.ts": code }
  const withoutImage = await runChecks(
    createMemorySource({
      files,
      diffText,
      repoFullName: "tscircuit/circuit-to-svg",
      pr: { body: "see foo.snap.svg" },
    }),
  )
  expect(
    withoutImage.findings.some(
      (finding) =>
        finding.checkId === "pr/visual-evidence" && finding.level === "error",
    ),
  ).toBe(true)
  const withImage = await runChecks(
    createMemorySource({
      files,
      diffText,
      repoFullName: "tscircuit/circuit-to-svg",
      pr: { body: "![before](https://x/a.png)" },
    }),
  )
  expect(
    withImage.findings.some(
      (finding) =>
        finding.checkId === "pr/visual-evidence" && finding.level === "error",
    ),
  ).toBe(false)
})
