#!/usr/bin/env bun
import { parseArgs } from "node:util"
import { auditPullRequests } from "../audit-pull-requests"

const { values: cliFlags } = parseArgs({
  options: {
    author: { type: "string", default: "@me" },
    since: { type: "string" },
    repo: { type: "string" },
    limit: { type: "string", default: "50" },
    concurrency: { type: "string", default: "8" },
  },
})

await auditPullRequests({
  author: cliFlags.author!,
  since: cliFlags.since,
  repo: cliFlags.repo,
  limit: cliFlags.limit!,
  concurrency: Number(cliFlags.concurrency),
})
