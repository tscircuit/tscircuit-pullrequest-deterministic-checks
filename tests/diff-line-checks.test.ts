import { expect, test } from "bun:test"
import {
  addedFileDiff,
  createMemorySource,
  getCheckIds,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("flags URL dependencies, manual circuit-json filtering, CI-skipped tests and AI comments", async () => {
  const testCode = [
    "// codex review: P1 this is fine",
    'test.skipIf(!existsSync("models"))("sim", () => {',
    '  const traces = circuitJson.filter((el) => el.type === "pcb_trace")',
    "})",
  ].join("\n")
  const diffText = [
    addedFileDiff("tests/sim.test.ts", testCode),
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -1,0 +1,1 @@",
    '+    "phase-skew": "https://github.com/x/y/releases/download/v1/y-1.tgz",',
  ].join("\n")
  const checkIds = await getCheckIds(
    createMemorySource({
      files: {
        ...plopRepoFiles,
        "package.json": JSON.stringify({
          ...JSON.parse(plopRepoFiles["package.json"]),
          dependencies: {
            "phase-skew": "https://github.com/x/y/releases/download/v1/y-1.tgz",
          },
        }),
        "tests/sim.test.ts": testCode,
      },
      diffText,
    }),
  )
  expect(checkIds).toContain("deps/no-url-deps")
  expect(checkIds).toContain("circuit-json/use-cju")
  expect(checkIds).toContain("tests/must-run-in-ci")
  expect(checkIds).toContain("comments/ai-artifacts")
})
