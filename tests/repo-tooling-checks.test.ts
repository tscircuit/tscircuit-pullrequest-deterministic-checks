import { expect, test } from "bun:test"
import {
  addedFileDiff,
  createMemorySource,
  getCheckIds,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("clean plop-style repo with handbook-compliant code has no findings", async () => {
  const code =
    "export function getTraceLength(params: { traceId: string }, ctx: { db: unknown }) {\n  return params.traceId.length\n}"
  const checkIds = await getCheckIds(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/get-trace-length.ts": code },
      diffText: addedFileDiff("lib/get-trace-length.ts", code),
    }),
  )
  expect(checkIds).toEqual([])
})

test("flags pnpm, eslint and a non-bun test runner", async () => {
  const files = {
    "package.json": JSON.stringify({
      packageManager: "pnpm@9.0.0",
      scripts: { test: "vitest", lint: "eslint ." },
      devDependencies: { eslint: "^9", vitest: "^2" },
    }),
    "pnpm-lock.yaml": "",
    "tests/a.test.ts": "",
  }
  const checkIds = await getCheckIds(
    createMemorySource({ files, diffText: "" }),
  )
  expect(new Set(checkIds)).toEqual(
    new Set([
      "tooling/bun-only",
      "tooling/bun-test",
      "tooling/biome",
      "tooling/ci",
    ]),
  )
})

test("plop's own release workflow (setup-node + npm install -g pver) is not flagged", async () => {
  const files = {
    ...plopRepoFiles,
    ".github/workflows/bun-pver-release.yml":
      "# Created using @tscircuit/plop (npm install -g @tscircuit/plop)\n- uses: actions/setup-node@v4\n- run: npm install -g pver",
  }
  expect(
    await getCheckIds(createMemorySource({ files, diffText: "" })),
  ).toEqual([])
})
