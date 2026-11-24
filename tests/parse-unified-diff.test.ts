import { expect, test } from "bun:test"
import { parseUnifiedDiff } from "lib/utils/parse-unified-diff"

test("maps added line numbers across hunks and keeps removed text", () => {
  const diffText = [
    "diff --git a/lib/example.ts b/lib/example.ts",
    "--- a/lib/example.ts",
    "+++ b/lib/example.ts",
    "@@ -2,3 +2,4 @@",
    " context",
    "-before",
    "+after",
    "+more",
    " context",
    "@@ -15 +16 @@",
    "-then",
    "+now",
    "\\ No newline at end of file",
  ].join("\n")

  expect(parseUnifiedDiff(diffText)).toEqual([
    {
      filePath: "lib/example.ts",
      status: "modified",
      addedLines: [
        { line: 3, text: "after" },
        { line: 4, text: "more" },
        { line: 16, text: "now" },
      ],
      removedLines: ["before", "then"],
    },
  ])
})

test("uses the destination path and records added, deleted, and renamed files", () => {
  const diffText = [
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1 @@",
    "+new content",
    "diff --git a/deleted.ts b/deleted.ts",
    "deleted file mode 100644",
    "--- a/deleted.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-old content",
    "diff --git a/old-name.ts b/new-name.ts",
    "similarity index 100%",
    "rename from old-name.ts",
    "rename to new-name.ts",
  ].join("\n")

  expect(parseUnifiedDiff(diffText)).toEqual([
    {
      filePath: "new.ts",
      status: "added",
      addedLines: [{ line: 1, text: "new content" }],
      removedLines: [],
    },
    {
      filePath: "deleted.ts",
      status: "deleted",
      addedLines: [],
      removedLines: ["old content"],
    },
    {
      filePath: "new-name.ts",
      status: "renamed",
      previousFilePath: "old-name.ts",
      addedLines: [],
      removedLines: [],
    },
  ])
})
