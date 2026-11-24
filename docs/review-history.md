# Review history behind each check

Recurring comments from ShiboSoftwareDev and seveibar on @0hmX's tscircuit PRs, 2026-11-17 → 2026-11-24 (51 comments, 16 PRs). Read this when a finding's intent is unclear, or when deciding whether a new comment deserves a check.

| Check | Reviewer comment (verbatim excerpt) | PRs |
|---|---|---|
| `tooling/bun-only` | "pnpm :(" | signal-integrity-pipeline#115 |
| `tooling/bun-test` | "it's not using bun test still?" | signal-integrity-pipeline#117 |
| `tooling/biome` | "you added custom formatting tools? we use biome and an established config in @tscircuit/plop" | signal-integrity-pipeline#125 |
| `tooling/ci` | "find tscircuit/plop which have our conventional ci files" / "so these tests will only run locally or what?" | signal-integrity-pipeline#143 |
| `handbook/map-string-key`, `handbook/two-parameter-rule`, `handbook/no-named-closures` | "It also carries forward a Map<string, …> and a three-parameter nested helper, both against handbook guidance." / "handbook violation" | signal-integrity-pipeline#125, #118, circuit-json-webgpu#116 |
| `handbook/file-size` | "some files are huge, are you following the tscircuit/handbook?" | signal-integrity-pipeline#119 |
| `circuit-json/use-cju` | "we use circuit-json-util for filtering circuit-json — `const db = cju(circuitJson); db.pcb_trace.list()`" | signal-integrity-pipeline#120 |
| `circuit-json/no-local-element-types` | "drop the pre-existing local pcb_hole override and use circuit-json directly" / "use the existing port and net ID types" | signal-integrity-pipeline#125, #116 |
| `imports/use-tscircuit-package` | "we import the tscircuit package, we stopped importing individual packages because they introduce technical debt and dependency conflicts" | signal-integrity-pipeline#115 |
| `deps/no-url-deps` | "we don't do this" / "don't do this" (on a GitHub-release .tgz dependency) | circuit-to-canvas#327, circuit-json-webgpu#116 |
| `deps/unneeded-bumps` | "why did you bump circuit-json when you don't need to update types for this PR? this adds noise" | circuit-json-webgpu#116 |
| `tests/must-run-in-ci` | "the models are not available as far as I can tell, this won't run on ci" | signal-integrity-pipeline#143, #117 |
| `comments/ai-artifacts`, `comments/density`, `pr/no-ai-review-paste` | "what's the purpose of these comments? you gotta write them manually, I don't want your AI review for your AI, you gotta validate what it's saying" / "these comments don't help unless you wrote them" | circuit-to-canvas#327, circuit-json-webgpu#116, signal-integrity-pipeline#117 |
| `pr/visual-evidence` | "you need to have the before/after snapshots here too, also put them in the pr body" / "put screenshots of before/after of relevant fixtures, also link to the relevant fixtures in the deployed preview" / "this PR handles geometry but there is no visualization" | pcb-viewer#1228, #1229, signal-integrity-pipeline#120 |
| `pr/renderer-order` | "this feature needs to be in circuit-to-canvas and circuit-to-svg first … we never start w/ webgpu because the snapshots aren't as readable" (Seve) | circuit-json-webgpu#114 |
| `pr/reference-comparison` | "you gotta have a reference from a working tool to compare to … put a side by side comparison to a real working reference" | pcb-viewer#1229, circuit-to-canvas#327, circuit-json-webgpu#116 |
| `pr/title-claims` | "this is not end to end like the title says" | signal-integrity-pipeline#143 |
| `tests/repro-as-tsx` | "this repro is really bad. There is no showing of the desired feature, just random shapes." | circuit-json-webgpu#114 |

## Not automatable (judgment)

- Justify physics constants and selection rules: "Why are we introducing fixed edge-duration assumptions instead of deriving the appropriate values from the IBIS model … justify the 4/3 ramp conversion" (signal-integrity-pipeline#141, #117).
- Input vs output API semantics (Seve, tscircuit-autorouter#4162): "`nominalTraceWidth` means THE COMPUTED TRACE WIDTH when it's on an output … when it's on an input it means the DESIRED TRACE WIDTH". Never add input semantics to an output type that every autorouter must implement.
- Correctness edge cases a reviewer spotted by reading: duplicate-binding order, interpolating across missing samples, WeakMap identity caching, filters bypassed by a new draw path.

## Replay result

`--pr <ref> --at <original_commit_id>` over every comment above: 21/27 automatable comments caught. Misses: 3 where the PR body or title was edited after the review (the replay uses the current body), 2 reference-comparison judgment calls, 1 vague "these comments" remark.
