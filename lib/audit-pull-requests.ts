import { checkPullRequest } from "./check-runner"
import { runCommand } from "./utils/run-command"

type CheckId = string

interface AuditContext {
  pendingPrUrls: string[]
  hitCountsByCheckId: Map<CheckId, number>
}

async function auditNextPr(ctx: AuditContext): Promise<void> {
  const prUrl = ctx.pendingPrUrls.shift()
  if (!prUrl) return
  try {
    const report = await checkPullRequest(prUrl)
    const firedCheckIds = new Set(
      report.findings.map((finding) => finding.checkId),
    )
    for (const checkId of firedCheckIds) {
      ctx.hitCountsByCheckId.set(
        checkId,
        (ctx.hitCountsByCheckId.get(checkId) ?? 0) + 1,
      )
    }
    console.log(
      `${report.errorCount}E ${report.warnCount}W  ${prUrl}  [${[...firedCheckIds].join(", ")}]`,
    )
  } catch (error) {
    console.log(`skip ${prUrl}: ${(error as Error).message.split("\n")[0]}`)
  }
  return auditNextPr(ctx)
}

export async function auditPullRequests(options: {
  author: string
  since?: string
  repo?: string
  limit: string
  concurrency: number
}): Promise<void> {
  const searchArgs = [
    "gh",
    "search",
    "prs",
    "--author",
    options.author,
    "--limit",
    options.limit,
    "--json",
    "url",
  ]
  if (options.since) searchArgs.push("--updated", `>=${options.since}`)
  if (options.repo) searchArgs.push("--repo", options.repo)
  const prs = JSON.parse(await runCommand(searchArgs)) as { url: string }[]
  const ctx: AuditContext = {
    pendingPrUrls: prs.map((pr) => pr.url),
    hitCountsByCheckId: new Map<CheckId, number>(),
  }
  await Promise.all(
    Array.from({ length: options.concurrency }, () => auditNextPr(ctx)),
  )

  console.log(`\nPRs where each check fired (of ${prs.length}):`)
  for (const [checkId, hitCount] of [...ctx.hitCountsByCheckId].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`${String(hitCount).padStart(4)}  ${checkId}`)
  }
}
