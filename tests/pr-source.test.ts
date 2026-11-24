import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPrSource } from "lib/sources/pr-source"
import { addedFileDiff } from "tests/fixtures/memory-source"
import { createGhPrView, installFakeGh } from "tests/fixtures/fake-gh"

const emptyDiffResponse = { argsInclude: ["/compare/"], stdout: "" }
const emptyPullDiffResponse = { argsInclude: ["/pulls/"], stdout: "" }

const sharedResponses = [
  {
    argsInclude: ["pr view 41", "--repo tscircuit/first-repo"],
    stdout: createGhPrView({
      repoFullName: "tscircuit/first-repo",
      number: 41,
      headSha: "first41",
    }),
  },
  {
    argsInclude: ["pr view 41", "--repo tscircuit/second-repo"],
    stdout: createGhPrView({
      repoFullName: "tscircuit/second-repo",
      number: 41,
      headSha: "second41",
    }),
  },
  {
    argsInclude: ["pr view 42"],
    stdout: createGhPrView({
      repoFullName: "tscircuit/pushed-repo",
      number: 42,
      headSha: "head1",
    }),
  },
  {
    // the live pull request endpoint already shows a newer push
    argsInclude: ["repos/tscircuit/pushed-repo/pulls/42"],
    stdout: addedFileDiff("lib/from-second-push.ts", "export const x = 2"),
  },
  {
    argsInclude: ["repos/tscircuit/pushed-repo/compare/base000...head1"],
    stdout: addedFileDiff("lib/from-first-push.ts", "export const x = 1"),
  },
  {
    argsInclude: ["pr view 43"],
    stdout: createGhPrView({
      repoFullName: "tscircuit/huge-repo",
      number: 43,
      headSha: "huge43",
    }),
  },
  {
    argsInclude: ["repos/tscircuit/huge-repo/compare/base000...huge43"],
    stdout: "",
  },
  {
    argsInclude: ["repos/tscircuit/huge-repo/pulls/43"],
    stdout: "",
  },
  {
    argsInclude: ["repos/tscircuit/huge-repo/git/trees/huge43"],
    stdout: JSON.stringify({
      truncated: true,
      tree: [{ path: "README.md", type: "blob" }],
    }),
  },
  emptyDiffResponse,
  emptyPullDiffResponse,
]
installFakeGh(sharedResponses)

test("a bare PR number is scoped to the repository it is run from", async () => {
  // `gh pr view 41` resolves against the current repo, so emulate that with --repo
  const firstSource = await createPrSource("tscircuit/first-repo#41")
  expect(firstSource.repoFullName).toBe("tscircuit/first-repo")

  const originalCwd = process.cwd()
  const otherRepoDir = mkdtempSync(join(tmpdir(), "other-repo-"))
  process.chdir(otherRepoDir)
  try {
    installFakeGh([
      {
        argsInclude: ["pr view 41"],
        stdout: createGhPrView({
          repoFullName: "tscircuit/second-repo",
          number: 41,
          headSha: "second41",
        }),
      },
      emptyDiffResponse,
      emptyPullDiffResponse,
    ])
    const bareFromOtherRepo = await createPrSource("41")
    process.chdir(originalCwd)
    installFakeGh([
      {
        argsInclude: ["pr view 41"],
        stdout: createGhPrView({
          repoFullName: "tscircuit/first-repo",
          number: 41,
          headSha: "first41",
        }),
      },
      emptyDiffResponse,
      emptyPullDiffResponse,
    ])
    const bareFromFirstRepo = await createPrSource("41")
    expect(bareFromOtherRepo.repoFullName).toBe("tscircuit/second-repo")
    expect(bareFromFirstRepo.repoFullName).toBe("tscircuit/first-repo")
  } finally {
    process.chdir(originalCwd)
    installFakeGh(sharedResponses)
  }
})

test("the diff is fetched for the exact head commit, not the live PR", async () => {
  const source = await createPrSource("tscircuit/pushed-repo#42")
  const changedFiles = await source.getChangedFiles()
  expect(changedFiles.map((changedFile) => changedFile.filePath)).toEqual([
    "lib/from-first-push.ts",
  ])
})

test("a truncated GitHub tree fails loudly instead of skipping files", async () => {
  const source = await createPrSource("tscircuit/huge-repo#43")
  await expect(source.listFiles()).rejects.toThrow(/truncated/)
})
