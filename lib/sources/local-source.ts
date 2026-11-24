import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ChangedFile, CheckSource } from "../types"
import { hashText } from "../utils/cache"
import { parseUnifiedDiff } from "../utils/parse-unified-diff"
import { runCommand } from "../utils/run-command"

async function resolveBaseRef(repoDir: string): Promise<string> {
  const originHead = await runCommand(
    ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd: repoDir, allowFailure: true },
  )
  if (originHead.trim()) return originHead.trim()
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const sha = await runCommand(
      ["git", "rev-parse", "--verify", "--quiet", candidate],
      { cwd: repoDir, allowFailure: true },
    )
    if (sha.trim()) return candidate
  }
  throw new Error("Could not find a base branch; pass baseRef")
}

function getRepoFullName(remoteUrl: string): string | undefined {
  const match = remoteUrl.trim().match(/github\.com[:/](.+?)(?:\.git)?$/)
  return match?.[1]
}

function readRepoFile(params: {
  repoDir: string
  filePath: string
}): string | null {
  const absolutePath = join(params.repoDir, params.filePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : null
}

/**
 * Working tree of a local checkout, diffed against merge-base(HEAD, baseRef).
 * Includes uncommitted and untracked files, since that is what you are about
 * to push.
 */
export async function createLocalSource(
  params: { repoDir?: string; baseRef?: string } = {},
): Promise<CheckSource> {
  const repoDir = (
    await runCommand(["git", "rev-parse", "--show-toplevel"], {
      cwd: params.repoDir ?? process.cwd(),
    })
  ).trim()
  const baseRef = params.baseRef ?? (await resolveBaseRef(repoDir))
  const mergeBaseSha = (
    await runCommand(["git", "merge-base", "HEAD", baseRef], { cwd: repoDir })
  ).trim()
  const diffText = await runCommand(
    [
      "git",
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      mergeBaseSha,
    ],
    { cwd: repoDir },
  )
  const untrackedPaths = (
    await runCommand(["git", "ls-files", "--others", "--exclude-standard"], {
      cwd: repoDir,
    })
  )
    .split("\n")
    .filter(Boolean)
  const trackedPaths = (await runCommand(["git", "ls-files"], { cwd: repoDir }))
    .split("\n")
    .filter(Boolean)
  const remoteUrl = await runCommand(["git", "remote", "get-url", "origin"], {
    cwd: repoDir,
    allowFailure: true,
  })

  const untrackedChanges: ChangedFile[] = await Promise.all(
    untrackedPaths.map(async (filePath) => {
      const content = readRepoFile({ repoDir, filePath }) ?? ""
      return {
        filePath,
        status: "added" as const,
        addedLines: content
          .split("\n")
          .map((text, index) => ({ line: index + 1, text })),
        removedLines: [],
      }
    }),
  )
  const changedFiles = [...parseUnifiedDiff(diffText), ...untrackedChanges]

  return {
    kind: "local",
    repoFullName: getRepoFullName(remoteUrl),
    revisionKey: `local:${mergeBaseSha}:${hashText(diffText + JSON.stringify(untrackedChanges))}`,
    listFiles: async () =>
      [...new Set([...trackedPaths, ...untrackedPaths])].filter((filePath) =>
        existsSync(join(repoDir, filePath)),
      ),
    readFile: async (filePath) => readRepoFile({ repoDir, filePath }),
    getChangedFiles: async () => changedFiles,
  }
}
