import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { astChecks } from "./checks/ast-checks"
import { diffLineChecks } from "./checks/diff-line-checks"
import { handbookLineChecks } from "./checks/handbook-line-checks"
import { prBodyChecks } from "./checks/pr-body-checks"
import { ciWorkflowChecks } from "./checks/ci-workflow-checks"
import { repoToolingChecks } from "./checks/repo-tooling-checks"
import { createLocalSource } from "./sources/local-source"
import { createPrSource, fetchPrMetadata } from "./sources/pr-source"
import type {
  ChangedFile,
  Check,
  CheckContext,
  CheckSource,
  Finding,
} from "./types"
import { cached, hashText } from "./utils/cache"

export const allChecks: Check[] = [
  ...repoToolingChecks,
  ...ciWorkflowChecks,
  ...handbookLineChecks,
  ...diffLineChecks,
  ...astChecks,
  ...prBodyChecks,
]

/** Hash of every check's source: editing a rule invalidates cached results. */
const checksSourceHash = hashText(
  ["checks", "sources", "utils"]
    .flatMap((dirName) => {
      const dirPath = join(import.meta.dir, dirName)
      return readdirSync(dirPath)
        .sort()
        .map((fileName) => readFileSync(join(dirPath, fileName), "utf8"))
    })
    .concat(
      ["check-runner.ts", "types.ts", "assets/plop-biome.json"].map(
        (filePath) => readFileSync(join(import.meta.dir, filePath), "utf8"),
      ),
    )
    .join("\n"),
)

export interface CheckReport {
  revisionKey: string
  repoFullName?: string
  prUrl?: string
  findings: Finding[]
  errorCount: number
  warnCount: number
}

export interface CheckOptions {
  /** Only run these groups (default: all) */
  groups?: Check["group"][]
  /** Only report findings whose check id starts with one of these prefixes */
  checkIdPrefixes?: string[]
}

function selectChecks(options: CheckOptions): Check[] {
  return allChecks.filter(
    (check) => !options.groups || options.groups.includes(check.group),
  )
}

/** One check can emit several ids (e.g. "deps" emits "deps/no-url-deps"), so filter findings, not checks. */
function isSelectedFinding(params: {
  finding: Finding
  options: CheckOptions
}): boolean {
  const { checkIdPrefixes } = params.options
  return (
    !checkIdPrefixes ||
    checkIdPrefixes.some((prefix) => params.finding.checkId.startsWith(prefix))
  )
}

/**
 * A finding on a file belongs to a PR that changed that file. A finding on a
 * directory (e.g. "no workflow runs bun test" on ".github/workflows") belongs
 * to a PR that deleted a file from it or renamed one out of it; merely editing
 * another file there doesn't make an existing gap this PR's fault.
 */
function isTouchedByChange(params: {
  filePath: string
  changedFiles: ChangedFile[]
}): boolean {
  const directoryPrefix = `${params.filePath}/`
  return params.changedFiles.some(
    (changedFile) =>
      changedFile.filePath === params.filePath ||
      (changedFile.status === "deleted" &&
        changedFile.filePath.startsWith(directoryPrefix)) ||
      (changedFile.status === "renamed" &&
        (changedFile.previousFilePath ?? "").startsWith(directoryPrefix)),
  )
}

async function runCheckList(params: {
  checks: Check[]
  ctx: CheckContext
}): Promise<Finding[]> {
  const findingLists = await Promise.all(
    params.checks.map((check) => check.run(params.ctx)),
  )
  return findingLists.flat()
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) ||
      (a.filePath ?? "").localeCompare(b.filePath ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.checkId.localeCompare(b.checkId),
  )
}

export async function runChecks(
  source: CheckSource,
  options: CheckOptions = {},
): Promise<CheckReport> {
  const checks = selectChecks(options)
  const ctx: CheckContext = {
    source,
    changedFiles: await source.getChangedFiles(),
    allFiles: await source.listFiles(),
  }
  const codeChecks = checks.filter((check) => check.group !== "pr")
  const prChecks = checks.filter((check) => check.group === "pr")
  // repo/diff results depend only on the revision + rule source: cache them.
  // PR-body checks depend on mutable metadata, so they always rerun (they are cheap).
  const codeFindings = await cached(
    {
      cacheKey: `findings:${checksSourceHash}:${source.revisionKey}:${codeChecks.map((check) => check.checkId).join(",")}`,
    },
    () => runCheckList({ checks: codeChecks, ctx }),
  )
  const repoCheckIds = new Set(
    checks
      .filter((check) => check.group === "repo")
      .map((check) => check.checkId),
  )
  // A repo-convention problem in a file this PR didn't touch is still worth fixing,
  // but it isn't this PR's fault: report it as a pre-existing warning.
  const attributedCodeFindings = codeFindings.map((finding) =>
    repoCheckIds.has(finding.checkId) &&
    finding.filePath &&
    !isTouchedByChange({
      filePath: finding.filePath,
      changedFiles: ctx.changedFiles,
    })
      ? {
          ...finding,
          level: "warn" as const,
          message: `pre-existing: ${finding.message}`,
        }
      : finding,
  )
  const findings = sortFindings(
    [
      ...attributedCodeFindings,
      ...(await runCheckList({ checks: prChecks, ctx })),
    ].filter((finding) => isSelectedFinding({ finding, options })),
  )
  return {
    revisionKey: source.revisionKey,
    repoFullName: source.repoFullName,
    prUrl: source.pr?.url,
    findings,
    errorCount: findings.filter((finding) => finding.level === "error").length,
    warnCount: findings.filter((finding) => finding.level === "warn").length,
  }
}

export async function checkPullRequest(
  prRef: string,
  options: CheckOptions & { atSha?: string } = {},
): Promise<CheckReport> {
  return runChecks(
    await createPrSource(prRef, { atSha: options.atSha }),
    options,
  )
}

export async function checkLocal(
  params: { repoDir?: string; baseRef?: string; prRef?: string } = {},
  options: CheckOptions = {},
): Promise<CheckReport> {
  const localSource = await createLocalSource(params)
  if (params.prRef) localSource.pr = await fetchPrMetadata(params.prRef)
  return runChecks(localSource, options)
}
