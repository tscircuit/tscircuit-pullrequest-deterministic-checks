import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runChecks } from "lib/index"
import { cacheDir, cached, hashText } from "lib/utils/cache"
import { parseUnifiedDiff } from "lib/utils/parse-unified-diff"
import {
  addedFileDiff,
  createMemorySource,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("parses quoted (non-ASCII) paths and `++` lines inside a hunk", () => {
  const changedFiles = parseUnifiedDiff(
    [
      'diff --git "a/lib/caf\\303\\251.ts" "b/lib/caf\\303\\251.ts"',
      "new file mode 100644",
      "--- /dev/null",
      '+++ "b/lib/caf\\303\\251.ts"',
      "@@ -0,0 +1,3 @@",
      "+let counter = 0",
      // the added line "++ counter" appears in the raw diff as "+++ counter"
      "+++ counter",
      "+export const seen = new Map<string, number>()",
    ].join("\n"),
  )
  expect(changedFiles.map((changedFile) => changedFile.filePath)).toEqual([
    "lib/café.ts",
  ])
  expect(
    changedFiles[0]!.addedLines.map((addedLine) => addedLine.line),
  ).toEqual([1, 2, 3])
})

test("--checks deps/ selects the dependency findings it documents", async () => {
  const diffText = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -1,1 +1,2 @@",
    ' "dependencies": {',
    '+    "example-widget": "file:./widget",',
  ].join("\n")
  const files = {
    ...plopRepoFiles,
    "package.json": JSON.stringify({
      ...JSON.parse(plopRepoFiles["package.json"]),
      dependencies: { "example-widget": "file:./widget" },
    }),
  }
  const report = await runChecks(createMemorySource({ files, diffText }), {
    checkIdPrefixes: ["handbook/", "deps/"],
  })
  expect(report.findings.map((finding) => finding.checkId)).toEqual([
    "deps/no-url-deps",
  ])
})

test("deleting the only test workflow is this PR's error, not pre-existing", async () => {
  const { ".github/workflows/bun-test.yml": _deleted, ...remainingFiles } =
    plopRepoFiles
  const diffText = [
    "diff --git a/.github/workflows/bun-test.yml b/.github/workflows/bun-test.yml",
    "deleted file mode 100644",
    "--- a/.github/workflows/bun-test.yml",
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    "-run: bun test",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...remainingFiles, "tests/a.test.ts": "" },
      diffText,
    }),
  )
  expect(report.errorCount).toBeGreaterThan(0)
})

test("a third parameter added on its own line is flagged", async () => {
  const content = [
    "export function build(",
    "  first: number,",
    "  second: number,",
    "  third: number,",
    ") {",
    "  return first + second + third",
    "}",
  ].join("\n")
  const diffText = [
    "diff --git a/lib/build.ts b/lib/build.ts",
    "--- a/lib/build.ts",
    "+++ b/lib/build.ts",
    "@@ -1,6 +1,7 @@",
    " export function build(",
    "   first: number,",
    "   second: number,",
    "+  third: number,",
    " ) {",
    "-  return first + second",
    "+  return first + second + third",
    " }",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/build.ts": content },
      diffText,
    }),
  )
  expect(report.findings.map((finding) => finding.checkId)).toContain(
    "handbook/two-parameter-rule",
  )
})

test("identical content in a test file doesn't hide a violation in lib/", async () => {
  const content = [
    "export default () => {",
    "  function inner() { return 1 }",
    "  return inner()",
    "}",
  ].join("\n")
  // the test file is checked first and allows closures in anonymous test callbacks
  await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "tests/board.test.ts": content },
      diffText: addedFileDiff("tests/board.test.ts", content),
    }),
  )
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/board.ts": content },
      diffText: addedFileDiff("lib/board.ts", content),
    }),
  )
  expect(report.findings.map((finding) => finding.checkId)).toContain(
    "handbook/no-named-closures",
  )
})

test("bin and script entries in package.json are not dependencies", async () => {
  const packageJson = {
    ...JSON.parse(plopRepoFiles["package.json"]),
    bin: { "my-cli": "lib/cli/check.ts" },
    scripts: { check: "file:./cli.ts" },
  }
  const diffText = [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -1,1 +1,4 @@",
    " {",
    '+  "bin": {',
    '+    "my-cli": "lib/cli/check.ts"',
    '+    "check": "file:./cli.ts",',
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: {
        ...plopRepoFiles,
        "package.json": JSON.stringify(packageJson),
      },
      diffText,
    }),
  )
  expect(
    report.findings.filter((finding) =>
      ["deps/no-url-deps", "deps/unneeded-bumps"].includes(finding.checkId),
    ),
  ).toEqual([])
})

test("an unconditional existsSync assertion is not a CI skip", async () => {
  const content = [
    'test("writes output", () => {',
    "  expect(existsSync(outputPath)).toBe(true)",
    "})",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "tests/output.test.ts": content },
      diffText: addedFileDiff("tests/output.test.ts", content),
    }),
  )
  expect(report.findings.map((finding) => finding.checkId)).not.toContain(
    "tests/must-run-in-ci",
  )
})

test("a corrupt cache entry is recomputed instead of aborting", async () => {
  const cacheKey = "test:corrupt-entry"
  const keyHash = hashText(cacheKey)
  mkdirSync(join(cacheDir, keyHash.slice(0, 2)), { recursive: true })
  writeFileSync(
    join(cacheDir, keyHash.slice(0, 2), `${keyHash}.json`),
    '{"cacheKey":',
  )
  expect(await cached({ cacheKey }, async () => "fresh")).toBe("fresh")
})
