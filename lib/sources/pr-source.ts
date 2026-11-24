import type { CheckSource, PrMetadata } from "../types"
import { cached } from "../utils/cache"
import { parseUnifiedDiff } from "../utils/parse-unified-diff"
import { runCommand } from "../utils/run-command"

const PR_METADATA_TTL_MS = 2 * 60 * 1000

interface GhPrView {
  url: string
  number: number
  title: string
  body: string
  author: { login: string }
  baseRefOid: string
  headRefOid: string
  headRepository: { name: string } | null
  headRepositoryOwner: { login: string } | null
  comments: { author: { login: string }; body: string }[]
}

/** Accepts a PR URL, "owner/repo#123", or a bare number (current repo). */
function toGhPrArgs(prRef: string): string[] {
  const shortMatch = prRef.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/)
  if (shortMatch) return [shortMatch[2]!, "--repo", shortMatch[1]!]
  return [prRef]
}

/** A bare PR number resolves against the current repo, so it must be cached per directory. */
function getPrMetadataCacheKey(prRef: string): string {
  return /^\d+$/.test(prRef)
    ? `pr-view:${process.cwd()}:${prRef}`
    : `pr-view:${prRef}`
}

export async function fetchPrMetadata(
  prRef: string,
): Promise<PrMetadata & { headRepoFullName: string }> {
  const prView = await cached(
    { cacheKey: getPrMetadataCacheKey(prRef), ttlMs: PR_METADATA_TTL_MS },
    async () =>
      JSON.parse(
        await runCommand([
          "gh",
          "pr",
          "view",
          ...toGhPrArgs(prRef),
          "--json",
          "url,number,title,body,author,baseRefOid,headRefOid,headRepository,headRepositoryOwner,comments",
        ]),
      ) as GhPrView,
  )
  const repoFullName = prView.url.match(/github\.com\/(.+?)\/pull\//)![1]!
  const headRepoFullName =
    prView.headRepository && prView.headRepositoryOwner
      ? `${prView.headRepositoryOwner.login}/${prView.headRepository.name}`
      : repoFullName
  return {
    url: prView.url,
    repoFullName,
    headRepoFullName,
    number: prView.number,
    title: prView.title,
    body: prView.body ?? "",
    authorLogin: prView.author.login,
    baseSha: prView.baseRefOid,
    headSha: prView.headRefOid,
    authorCommentBodies: prView.comments
      .filter((comment) => comment.author.login === prView.author.login)
      .map((comment) => comment.body),
  }
}

interface CommitRef {
  repoFullName: string
  sha: string
}

function listFilesAtCommit(commitRef: CommitRef): Promise<string[]> {
  return cached(
    { cacheKey: `tree:${commitRef.repoFullName}:${commitRef.sha}` },
    async () => {
      const tree = JSON.parse(
        await runCommand([
          "gh",
          "api",
          `repos/${commitRef.repoFullName}/git/trees/${commitRef.sha}?recursive=1`,
        ]),
      ) as { truncated?: boolean; tree: { path: string; type: string }[] }
      if (tree.truncated) {
        // a partial tree would silently skip checks, so refuse instead of caching it
        throw new Error(
          `GitHub truncated the file tree of ${commitRef.repoFullName}@${commitRef.sha}; check a local clone instead (run without --pr, or with --local)`,
        )
      }
      return tree.tree
        .filter((entry) => entry.type === "blob")
        .map((entry) => entry.path)
    },
  )
}

async function readFileAtCommit(
  params: CommitRef & { filePath: string },
): Promise<string | null> {
  const allFiles = await listFilesAtCommit(params)
  if (!allFiles.includes(params.filePath)) return null
  return cached(
    {
      cacheKey: `blob:${params.repoFullName}:${params.sha}:${params.filePath}`,
    },
    () =>
      runCommand([
        "gh",
        "api",
        `repos/${params.repoFullName}/contents/${encodeURI(params.filePath)}?ref=${params.sha}`,
        "-H",
        "Accept: application/vnd.github.raw",
      ]),
  )
}

/**
 * A GitHub PR read through `gh`, exactly as reviewers see it. File contents,
 * the tree and the diff are cached forever by commit sha; only PR metadata
 * (title/body/comments) has a short TTL.
 */
export async function createPrSource(
  prRef: string,
  options: { atSha?: string } = {},
): Promise<CheckSource> {
  const pr = await fetchPrMetadata(prRef)
  const { headRepoFullName, baseSha } = pr
  // atSha replays the PR as it was at an earlier push (e.g. when a review comment was left)
  const headSha = options.atSha ?? pr.headSha

  // Always diff the exact commits: the live pull request endpoint can already
  // show a newer push, which must never be cached under this headSha.
  const diffText = await cached(
    { cacheKey: `pr-diff:${pr.repoFullName}:${baseSha}:${headSha}` },
    () =>
      runCommand([
        "gh",
        "api",
        `repos/${headRepoFullName}/compare/${baseSha}...${headSha}`,
        "-H",
        "Accept: application/vnd.github.diff",
      ]),
  )
  const changedFiles = parseUnifiedDiff(diffText)

  return {
    kind: "pr",
    repoFullName: pr.repoFullName,
    revisionKey: `pr:${pr.repoFullName}:${baseSha}:${headSha}`,
    listFiles: () =>
      listFilesAtCommit({ repoFullName: headRepoFullName, sha: headSha }),
    readFile: (filePath) =>
      readFileAtCommit({
        repoFullName: headRepoFullName,
        sha: headSha,
        filePath,
      }),
    getChangedFiles: async () => changedFiles,
    pr: { ...pr, headSha },
  }
}
