# tscircuit pull request deterministic checks

A Bun CLI and TypeScript API for catching the same issues tscircuit maintainers raise repeatedly in review. The checks cover Bun, Biome, and plop setup, handbook conventions, circuit-json-util usage, dependency changes, tests that may be skipped in CI, and visual evidence in PR descriptions. See the [review history](docs/review-history.md) for the comments behind each check.

## CLI

Clone this repository and run `bun install` in the clone. Then run the checker from the repository you want to review. Set `CHECKER_REPO` to the absolute path of the clone.

```sh
# Compare against origin's default branch, including uncommitted and untracked files.
bun "$CHECKER_REPO/lib/cli/check.ts"

# Use an explicit base or check another working tree.
bun "$CHECKER_REPO/lib/cli/check.ts" --base origin/main --dir /path/to/checkout

# Read a GitHub PR with gh, without checking it out.
bun "$CHECKER_REPO/lib/cli/check.ts" --pr tscircuit/pcb-viewer#1228

# Replay an earlier commit, using the current PR title, body, and comments.
bun "$CHECKER_REPO/lib/cli/check.ts" --pr tscircuit/pcb-viewer#1228 --at <commit-sha>

# Check the local working tree together with a PR's title, body, and comments.
bun "$CHECKER_REPO/lib/cli/check.ts" --pr tscircuit/pcb-viewer#1228 --local

# Select groups and check ID prefixes, and emit a JSON report.
bun "$CHECKER_REPO/lib/cli/check.ts" --groups repo,diff --checks handbook/,deps/ --json
```

`--pr` accepts a GitHub URL, `owner/repo#number`, or a bare number from within that repo. GitHub commands use an authenticated `gh` CLI. The checker exits with code 1 when it finds an error. A `pre-existing:` warning means the repo-level finding refers to a file outside the change. The first finding for a check includes the review quote when available.

The package also exposes the `tscircuit-pullrequest-deterministic-checks` command when installed into a Bun project. To audit which checks fire across several PRs, run `bun "$CHECKER_REPO/lib/cli/audit.ts" --author @me --since 2026-11-14`. The audit also accepts `--repo`, `--limit`, and `--concurrency`.

## Code-mode API

Import the API from `lib/index.ts` in a clone, or from the package after adding it to a Bun project with `bun add github:tscircuit/tscircuit-pullrequest-deterministic-checks`.

```ts
import {
  checkLocal,
  checkPullRequest,
  formatFindings,
} from "tscircuit-pullrequest-deterministic-checks"

const report = await checkPullRequest("tscircuit/pcb-viewer#1228", {
  groups: ["diff", "pr"],
})
console.log(formatFindings(report.findings))

await checkLocal({ repoDir: "/path/to/checkout", baseRef: "origin/main" })
```

The API also exports `allChecks`, `runChecks(source, options)`, `createPrSource`, `createLocalSource`, `fetchPrMetadata`, `cached({ cacheKey, ttlMs }, compute)`, and `hashText`.

## Cache rules

The default cache directory is `~/.cache/tscircuit-pullrequest-deterministic-checks/v1`. Set `PULLREQUEST_DETERMINISTIC_CHECKS_CACHE_DIR` to override it or `PULLREQUEST_DETERMINISTIC_CHECKS_NO_CACHE=1` to disable disk caching.

- Diffs are cached by base and head commit, and file trees and contents by commit.
- AST results are cached by content hash. Repository and diff findings are cached by revision, selected checks, and a hash of the checker source.
- PR titles, bodies, and comments are cached for two minutes. PR-body checks rerun on every invocation.

## Adding a check

1. Add the check under [`lib/checks/`](lib/checks). Use the repository tooling module for configuration, the line-check modules for added lines, the AST module for syntax, or the PR-body module for metadata.
2. Report added lines where possible and use the reviewer's words in the `why` field. Register new modules in [`lib/check-runner.ts`](lib/check-runner.ts).
3. Add a focused test under [`tests/`](tests), run `bun test`, and replay the original PR with `--pr` and `--at` to confirm the finding.
4. Record the review comment in [`docs/review-history.md`](docs/review-history.md).

See the [agent skill](skill/SKILL.md) for the pre-review workflow.

## What still needs a human

1. **Use a real reference.** For numerical, physics, or rendering work, show a side-by-side comparison with a working external tool such as KiCad, ngspice, or HyperLynx. The check can detect a mention of a comparison.
2. **Justify constants.** Give a source or derivation for assumptions such as a 4/3 ramp factor, fallback via diameters, or a minimum across fixtures.
3. **Keep inputs and outputs distinct.** Use `desiredX` for an input target. Output fields represent results every implementer computes.
4. **Show the feature in the reproduction.** Write a visual TSX fixture that makes the desired behavior obvious.
5. **Start upstream.** Implement new drawing features in circuit-to-canvas and circuit-to-svg before WebGPU or pcb-viewer.
6. **Validate AI review findings before acting on them.** Write PR replies in your own words.
