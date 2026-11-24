---
name: tscircuit-pullrequest-deterministic-checks
description: Deterministic pre-review checks for tscircuit pull requests, built from the comments maintainers (Shibo, Seve) keep repeating — bun/biome/plop tooling, tscircuit/handbook code rules (two-parameter rule, no Map<string>, no named closures, no `as any`), circuit-json-util usage, URL/unneeded dependency bumps, tests that won't run in CI, AI comments left in code, and missing before/after images in the PR body. Use this skill before opening, pushing to, or marking ready any PR in a tscircuit/* repo, after finishing agent-written changes in a tscircuit repo, when asked to "run the checks", "preflight", "check my PR", "will Shibo/Seve complain", or to audit which review comments keep recurring — even if the user doesn't name the skill. Also use it in code mode: import its TypeScript API from a Bun script to batch-check many PRs with a deterministic on-disk cache.
---

# tscircuit pull request deterministic checks

Maintainers on tscircuit repos kept leaving the same review comments: "pnpm :(", "it's not using bun test still?", "handbook violation", "we use circuit-json-util", "you need before/after snapshots in the PR body", "this won't run on CI", "I don't want your AI review for your AI". Each round-trip costs a day. This skill turns those comments into deterministic checks so they get fixed before a human has to say them.

Replaying the checks against the commits Shibo and Seve actually reviewed (Nov 2026) caught 21 of 27 automatable comments. The rest need judgment — see "What still needs you" below.

## Run it

Run `bun install` in a clone of this repository. Set `CHECKER_REPO` to the absolute path of that clone and run the checker from the repository you want to review.

```bash
# Local branch (incl. uncommitted + untracked files) vs origin's default branch — run from the repo
bun "$CHECKER_REPO/lib/cli/check.ts"

# A PR exactly as reviewers see it (no checkout needed)
bun "$CHECKER_REPO/lib/cli/check.ts" --pr https://github.com/tscircuit/pcb-viewer/pull/1228
bun "$CHECKER_REPO/lib/cli/check.ts" --pr tscircuit/pcb-viewer#1228

# Local working tree + the open PR's title/body (fix locally, check the body too)
bun "$CHECKER_REPO/lib/cli/check.ts" --pr tscircuit/pcb-viewer#1228 --local

# Narrow it, or get JSON
bun "$CHECKER_REPO/lib/cli/check.ts" --groups repo,diff --checks handbook/,deps/ --json
```

Exit code is 1 when any `error` finding exists. First run on a PR takes ~20s (GitHub fetches); repeat runs on the same commits take well under a second.

The checker uses TypeScript at runtime to parse source code. Remote PR checks require an authenticated `gh` CLI.

## How to act on findings

- **error** = a maintainer has explicitly rejected this before. Fix it before pushing. Don't silence a check by rewording code to dodge the regex; that just moves the comment to review.
- **warn** = usually right but needs a look (big file, comment density, a dependency bump). Fix it or be ready to justify it in the PR body.
- **`pre-existing:`** = a repo-level problem in a file this PR didn't touch (e.g. pnpm in a repo you didn't set up). Don't fix it unasked in an unrelated PR — that adds the diff noise Shibo also objects to. Mention it to the user, or fix it in its own PR.
- Each finding's `↳` line quotes the review comment it exists to preempt. Use it to understand intent instead of mechanically satisfying the rule.

When fixing, follow `tscircuit/handbook/guides/code.md` (named-params object or `(params, ctx)`, hoisted helpers, `Map<BrandedId, …>`, google-style casing, no data/info/value/param names) and copy configs from `tscircuit/plop/template-files/` rather than writing your own.

## What still needs you

These came up repeatedly too, but a regex can't judge them. Check them by hand before asking for review:

1. **A real reference.** For numeric, physics, or rendering-correctness work, show a side-by-side against a working external tool (KiCad, ngspice, HyperLynx…), not just another tscircuit renderer. `pr/reference-comparison` only checks that such a comparison is mentioned.
2. **Justify constants.** Every magic number (4/3 ramp factor, fallback via diameters, min-across-fixtures) needs a source or derivation in the code or PR.
3. **Input vs output types** (Seve). A field on an *output* type (e.g. SimpleRouteJson results) is something every implementer must compute. Don't put "desired" input semantics there; use `desiredX` on inputs.
4. **The repro shows the feature.** A visual repro should be TSX that makes the desired behavior obvious, not random shapes.
5. **Order of work.** New drawing features go to circuit-to-canvas and circuit-to-svg first, then WebGPU/pcb-viewer.
6. **Validate any AI review before acting on it**, and write PR replies in your own words.

## Code mode

For anything beyond one PR, write a small Bun script against the API instead of chaining tool calls. Results are plain objects, and everything immutable is cached on disk, so re-running is deterministic and nearly free.

```ts
// /tmp/check-my-prs.ts — run with: bun /tmp/check-my-prs.ts
import { checkPullRequest, checkLocal, formatFindings } from "/Users/you/code/tscircuit-pullrequest-deterministic-checks/lib/index.ts"

for (const prRef of ["tscircuit/pcb-viewer#1228", "tscircuit/circuit-to-canvas#327"]) {
  const report = await checkPullRequest(prRef, { groups: ["diff", "pr"] })
  console.log(prRef, report.errorCount, "errors")
  console.log(formatFindings(report.findings.filter((finding) => finding.level === "error")))
}

// Replay a PR at the commit a review comment was left on
await checkPullRequest("tscircuit/signal-integrity-pipeline#118", { atSha: "<original_commit_id>" })

// Local checkout, plus the open PR's body
await checkLocal({ repoDir: "/Users/you/code/pcb-viewer", prRef: "tscircuit/pcb-viewer#1228" })
```

(Use absolute paths: Bun does not expand `~` in imports.)

The API also exports `allChecks`, `runChecks(source)`, `createPrSource`, `createLocalSource`, and `cached({ cacheKey, ttlMs? }, compute)`. Use `cached` for your own expensive steps keyed by commit sha or content hash. Types are in `lib/types.ts`.

`lib/cli/audit.ts` is a ready-made batch run: `bun "$CHECKER_REPO/lib/cli/audit.ts" --author 0hmX --since 2026-11-14` prints which checks fire across your recent PRs.

### Cache rules

- Location: `~/.cache/tscircuit-pullrequest-deterministic-checks/v1` (`PULLREQUEST_DETERMINISTIC_CHECKS_CACHE_DIR` overrides; `PULLREQUEST_DETERMINISTIC_CHECKS_NO_CACHE=1` disables).
- Cached forever: diff by base+head sha, file tree and file contents by commit sha, AST results by content hash, whole-run findings by revision + a hash of the checks' own source. Editing any check invalidates its results automatically.
- Short TTL (2 min): PR title, body, and comments, which are mutable. PR-body checks always rerun.

## Adding a check

When a maintainer leaves a new comment you expect to see again, add a check instead of just remembering it:

1. Put it in the right module under `lib/checks/`: `repo-tooling-checks.ts` (whole-repo config), `handbook-line-checks.ts` / `diff-line-checks.ts` (added lines; `createLinePatternCheck` covers most cases), `ast-checks.ts` (needs syntax), or `pr-body-checks.ts` (title/body/comments).
2. Report only on added lines where possible, so people aren't blamed for code they didn't touch.
3. Set `why` to the reviewer's actual words.
4. Add a case to the matching test under `tests/` and run `bun test`, then replay the real PR with `--pr … --at <sha>` to confirm it fires.
5. Add the comment to `docs/review-history.md`.
