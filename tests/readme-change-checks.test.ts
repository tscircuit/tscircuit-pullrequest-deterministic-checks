import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "tests/fixtures/memory-source"

const CHECK_ID = "docs/review-readme-change"

test("warns once per changed README, including additions, deletions and renames", async () => {
  const diffText = [
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -93,2 +93,2 @@",
    "-Old description",
    "-Old example",
    "+Updated description",
    "+Updated example",
    addedFileDiff("packages/driver/Readme.rst", "Driver instructions"),
    "diff --git a/examples/README b/examples/README",
    "deleted file mode 100644",
    "--- a/examples/README",
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-Old example instructions",
    "diff --git a/docs/readme.mdx b/docs/setup.mdx",
    "similarity index 100%",
    "rename from docs/readme.mdx",
    "rename to docs/setup.mdx",
    "diff --git a/guide.md b/tools/README.txt",
    "similarity index 100%",
    "rename from guide.md",
    "rename to tools/README.txt",
  ].join("\n")
  const report = await runChecks(createMemorySource({ files: {}, diffText }), {
    groups: ["diff"],
    checkIdPrefixes: [CHECK_ID],
  })

  expect(report.errorCount).toBe(0)
  expect(report.warnCount).toBe(5)
  expect(report.findings).toMatchObject([
    {
      filePath: "docs/setup.mdx",
      message: expect.stringContaining("renamed from docs/readme.mdx"),
    },
    { filePath: "examples/README", line: undefined },
    { filePath: "packages/driver/Readme.rst", line: 1 },
    { filePath: "README.md", line: 93 },
    { filePath: "tools/README.txt", line: undefined },
  ])
})

test("does not warn about README mentions, unrelated paths or unchanged README files", async () => {
  const diffText = [
    addedFileDiff("docs/guide.md", "See README.md first."),
    addedFileDiff("src/README.ts", "export const name = 'README'"),
    addedFileDiff("docs/README-notes.md", "Maintainer notes"),
    addedFileDiff("README.md/assets/logo.txt", "logo"),
  ].join("\n")
  const report = await runChecks(
    createMemorySource({ files: { "README.md": "# Unchanged" }, diffText }),
    { groups: ["diff"], checkIdPrefixes: [CHECK_ID] },
  )
  expect(report.findings).toEqual([])
})
