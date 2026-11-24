#!/usr/bin/env bun
import { parseArgs } from "node:util"
import {
  type CheckOptions,
  checkLocal,
  checkPullRequest,
  formatFindings,
} from "../index"

const { values: cliFlags } = parseArgs({
  options: {
    pr: { type: "string" },
    at: { type: "string" },
    local: { type: "boolean", default: false },
    base: { type: "string" },
    dir: { type: "string" },
    groups: { type: "string" },
    checks: { type: "string" },
    json: { type: "boolean", default: false },
  },
})

const options: CheckOptions = {
  groups: cliFlags.groups?.split(",") as CheckOptions["groups"],
  checkIdPrefixes: cliFlags.checks?.split(","),
}

const report =
  cliFlags.pr && !cliFlags.local
    ? await checkPullRequest(cliFlags.pr, { ...options, atSha: cliFlags.at })
    : await checkLocal(
        { repoDir: cliFlags.dir, baseRef: cliFlags.base, prRef: cliFlags.pr },
        options,
      )

if (cliFlags.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(
    `checks ${report.prUrl ?? report.repoFullName ?? ""} (${report.revisionKey.slice(0, 60)})`,
  )
  console.log(formatFindings(report.findings))
  console.log(`\n${report.errorCount} error(s), ${report.warnCount} warning(s)`)
}
process.exit(report.errorCount > 0 ? 1 : 0)
