import { afterEach, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { runChecks } from "lib/index"
import { createPrSource } from "lib/sources/pr-source"
import { cacheDir, cached, hashText } from "lib/utils/cache"
import { parseUnifiedDiff } from "lib/utils/parse-unified-diff"
import { createGhPrView, installFakeGh } from "tests/fixtures/fake-gh"
import {
  addedFileDiff,
  createMemorySource,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

afterEach(() => {
  delete process.env.GH_REPO
})

async function getFindingLevels(params: {
  files: Record<string, string>
  diffText: string
}): Promise<string[]> {
  const report = await runChecks(createMemorySource(params))
  return report.findings.map((finding) => `${finding.level} ${finding.checkId}`)
}

test("the cache is versioned even under a custom directory", () => {
  expect(cacheDir).toMatch(/[/\\]v\d+$/)
})

test("an entry without a payload is a cache miss", async () => {
  const cacheKey = "test:null-payload"
  const keyHash = hashText(cacheKey)
  mkdirSync(join(cacheDir, keyHash.slice(0, 2)), { recursive: true })
  writeFileSync(
    join(cacheDir, keyHash.slice(0, 2), `${keyHash}.json`),
    JSON.stringify({ cacheKey, storedAtMs: Date.now(), payload: null }),
  )
  expect(await cached({ cacheKey }, async () => "fresh")).toBe("fresh")
})

test("a bare PR number is scoped by GH_REPO too", async () => {
  const prViewFor = (repoFullName: string) =>
    createGhPrView({ repoFullName, number: 77, headSha: `${repoFullName}77` })
  installFakeGh([
    {
      argsInclude: ["pr view 77"],
      env: { GH_REPO: "tscircuit/env-first" },
      stdout: prViewFor("tscircuit/env-first"),
    },
    {
      argsInclude: ["pr view 77"],
      env: { GH_REPO: "tscircuit/env-second" },
      stdout: prViewFor("tscircuit/env-second"),
    },
    { argsInclude: ["/compare/"], stdout: "" },
  ])
  process.env.GH_REPO = "tscircuit/env-first"
  expect((await createPrSource("77")).repoFullName).toBe("tscircuit/env-first")
  process.env.GH_REPO = "tscircuit/env-second"
  expect((await createPrSource("77")).repoFullName).toBe("tscircuit/env-second")
})

test("invalid package.json is reported instead of aborting a filtered run", async () => {
  const testCode = 'test.skip("later", () => {})'
  const report = await runChecks(
    createMemorySource({
      files: {
        ...plopRepoFiles,
        "package.json": "{",
        "tests/a.test.ts": testCode,
      },
      diffText: addedFileDiff("tests/a.test.ts", testCode),
    }),
    { checkIdPrefixes: ["tests/must-run-in-ci", "tooling/bun-only"] },
  )
  expect(
    report.findings.some((finding) =>
      finding.message.endsWith("package.json is not valid JSON"),
    ),
  ).toBe(true)
  expect(report.findings.map((finding) => finding.checkId)).toContain(
    "tests/must-run-in-ci",
  )
})

test("a URL dependency is caught even if another section has the same name", async () => {
  const packageJson = {
    ...JSON.parse(plopRepoFiles["package.json"]),
    dependencies: { foo: "file:../foo" },
    devDependencies: { foo: "^1.0.0" },
  }
  const levels = await getFindingLevels({
    files: { ...plopRepoFiles, "package.json": JSON.stringify(packageJson) },
    diffText: [
      "diff --git a/package.json b/package.json",
      "--- a/package.json",
      "+++ b/package.json",
      "@@ -1,1 +1,1 @@",
      '-    "foo": "^1.0.0",',
      '+    "foo": "file:../foo",',
    ].join("\n"),
  })
  expect(levels).toContain("error deps/no-url-deps")
})

test("file/env guards that skip tests are flagged; guards that fail them are not", async () => {
  const content = [
    'existsSync(modelPath) && test("sim", () => {})',
    "const runSlow = process.env.SLOW ? test : test.skip",
    'test("needs model", () => {',
    '  if (!existsSync(modelPath)) throw new Error("model missing")',
    "})",
  ].join("\n")
  const report = await runChecks(
    createMemorySource({
      files: { ...plopRepoFiles, "tests/model.test.ts": content },
      diffText: addedFileDiff("tests/model.test.ts", content),
    }),
  )
  const flaggedLines = report.findings
    .filter((finding) => finding.checkId === "tests/must-run-in-ci")
    .map((finding) => finding.line)
  expect(flaggedLines).toEqual([1, 2])
})

test("renaming the test workflow out of .github/workflows is this PR's error", async () => {
  const { ".github/workflows/bun-test.yml": movedWorkflow, ...remainingFiles } =
    plopRepoFiles
  const levels = await getFindingLevels({
    files: {
      ...remainingFiles,
      "bun-test.yml": movedWorkflow,
      "tests/a.test.ts": "",
    },
    diffText: [
      "diff --git a/.github/workflows/bun-test.yml b/bun-test.yml",
      "similarity index 100%",
      "rename from .github/workflows/bun-test.yml",
      "rename to bun-test.yml",
    ].join("\n"),
  })
  expect(levels).toContain("error tooling/ci")
})

test("editing an unrelated workflow doesn't make an existing gap this PR's error", async () => {
  const { ".github/workflows/bun-test.yml": _missing, ...remainingFiles } =
    plopRepoFiles
  const levels = await getFindingLevels({
    files: { ...remainingFiles, "tests/a.test.ts": "" },
    diffText: [
      "diff --git a/.github/workflows/bun-typecheck.yml b/.github/workflows/bun-typecheck.yml",
      "--- a/.github/workflows/bun-typecheck.yml",
      "+++ b/.github/workflows/bun-typecheck.yml",
      "@@ -1,1 +1,1 @@",
      "-run: bunx tsc --noEmit",
      "+run: bunx tsc --noEmit --pretty",
    ].join("\n"),
  })
  expect(levels).toContain("warn tooling/ci")
  expect(levels).not.toContain("error tooling/ci")
})

test("pure renames, mode-only changes, emoji paths and CRLF headers keep their paths", () => {
  const changedFiles = parseUnifiedDiff(
    [
      'diff --git "a/old\\t.ts" b/new.ts',
      "similarity index 100%",
      'rename from "old\\t.ts"',
      "rename to new.ts",
      "diff --git a/bin b/check b/bin b/check",
      "old mode 100644",
      "new mode 100755",
      'diff --git "a/\\360\\237\\230\\200\\t.ts" "b/\\360\\237\\230\\200\\t.ts"',
      "old mode 100644",
      "new mode 100755",
      "diff --git a/lib/crlf.ts b/lib/crlf.ts\r",
      "old mode 100644\r",
      "new mode 100755\r",
    ].join("\n"),
  )
  expect(
    changedFiles.map((changedFile) => [
      changedFile.filePath,
      changedFile.status,
      changedFile.previousFilePath,
    ]),
  ).toEqual([
    ["new.ts", "renamed", "old\t.ts"],
    ["bin b/check", "modified", undefined],
    ["😀\t.ts", "modified", undefined],
    ["lib/crlf.ts", "modified", undefined],
  ])
})

test("editing only an arrow function's body doesn't flag its signature", async () => {
  const content = [
    "export const build = (first: number, second: number, third: number) =>",
    "  first + second + third + 1",
  ].join("\n")
  const levels = await getFindingLevels({
    files: { ...plopRepoFiles, "lib/build.ts": content },
    diffText: [
      "diff --git a/lib/build.ts b/lib/build.ts",
      "--- a/lib/build.ts",
      "+++ b/lib/build.ts",
      "@@ -1,2 +1,2 @@",
      " export const build = (first: number, second: number, third: number) =>",
      "-  first + second + third",
      "+  first + second + third + 1",
    ].join("\n"),
  })
  expect(levels).not.toContain("error handbook/two-parameter-rule")
})
