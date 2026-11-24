import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import {
  addedFileDiff,
  createMemorySource,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

function packageJsonDiff(params: {
  removedLines: string[]
  addedLines: string[]
}): string {
  return [
    "diff --git a/package.json b/package.json",
    "--- a/package.json",
    "+++ b/package.json",
    `@@ -1,${params.removedLines.length + 1} +1,${params.addedLines.length + 1} @@`,
    " {",
    ...params.removedLines.map((line) => `-${line}`),
    ...params.addedLines.map((line) => `+${line}`),
  ].join("\n")
}

async function getOneLineFindings(diffText: string) {
  const report = await runChecks(
    createMemorySource({ files: plopRepoFiles, diffText }),
    { checkIdPrefixes: ["deps/package-json-one-line"] },
  )
  return report.findings
}

test("a single version bump (one line removed, one added) is allowed", async () => {
  const findings = await getOneLineFindings(
    packageJsonDiff({
      removedLines: ['    "circuit-json": "^0.0.561",'],
      addedLines: ['    "circuit-json": "^0.0.562",'],
    }),
  )
  expect(findings).toEqual([])
})

test("two changed lines in package.json are an error", async () => {
  const findings = await getOneLineFindings(
    packageJsonDiff({
      removedLines: ['    "circuit-json": "^0.0.561",'],
      addedLines: [
        '    "circuit-json": "^0.0.562",',
        '    "@types/react": "^19.1.0",',
      ],
    }),
  )
  expect(findings.map((finding) => [finding.level, finding.message])).toEqual([
    [
      "error",
      "2 changed lines; a PR may change at most 1 line in package.json, so split the other changes into their own PRs",
    ],
  ])
})

test("each package.json in a monorepo is limited separately", async () => {
  const diffText = [
    packageJsonDiff({
      removedLines: [],
      addedLines: ['    "a": "^1.0.0",'],
    }),
    packageJsonDiff({
      removedLines: [],
      addedLines: ['    "b": "^1.0.0",'],
    }).replaceAll("package.json", "packages/board/package.json"),
  ].join("\n")
  expect(await getOneLineFindings(diffText)).toEqual([])
})

test("a brand-new package.json is exempt", async () => {
  const findings = await getOneLineFindings(
    addedFileDiff(
      "package.json",
      ["{", '  "name": "new-repo",', '  "type": "module"', "}"].join("\n"),
    ),
  )
  expect(findings).toEqual([])
})
