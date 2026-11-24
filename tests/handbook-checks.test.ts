import { expect, test } from "bun:test"
import {
  addedFileDiff,
  createMemorySource,
  getCheckIds,
  plopRepoFiles,
} from "tests/fixtures/memory-source"

test("flags Map<string>, 3 params, named closures and as any on added lines", async () => {
  const code = [
    "export function build(a: number, b: number, c: number) {",
    "  const seen = new Map<string, number>()",
    "  function helper() { return seen }",
    "  return helper() as any",
    "}",
  ].join("\n")
  const checkIds = await getCheckIds(
    createMemorySource({
      files: { ...plopRepoFiles, "lib/build.ts": code },
      diffText: addedFileDiff("lib/build.ts", code),
    }),
  )
  expect(checkIds).toContain("handbook/map-string-key")
  expect(checkIds).toContain("handbook/two-parameter-rule")
  expect(checkIds).toContain("handbook/no-named-closures")
  expect(checkIds).toContain("handbook/no-as-any")
})
