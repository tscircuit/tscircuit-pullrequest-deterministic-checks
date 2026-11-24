import { runChecks } from "lib/index"
import type { CheckSource, PrMetadata } from "lib/types"
import { parseUnifiedDiff } from "lib/utils/parse-unified-diff"

let revisionNumber = 0

export function createMemorySource(params: {
  files: Record<string, string>
  diffText: string
  pr?: Partial<PrMetadata>
  repoFullName?: string
}): CheckSource {
  return {
    kind: "pr",
    repoFullName: params.repoFullName ?? "tscircuit/example",
    revisionKey: `memory:${++revisionNumber}`,
    listFiles: async () => Object.keys(params.files),
    readFile: async (filePath) => params.files[filePath] ?? null,
    getChangedFiles: async () => parseUnifiedDiff(params.diffText),
    pr: params.pr
      ? {
          url: "https://github.com/tscircuit/example/pull/1",
          repoFullName: "tscircuit/example",
          number: 1,
          title: "",
          body: "",
          authorLogin: "someone",
          baseSha: "a",
          headSha: "b",
          authorCommentBodies: [],
          ...params.pr,
        }
      : undefined,
  }
}

export function addedFileDiff(filePath: string, content: string): string {
  const lines = content.split("\n")
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")
}

export const plopRepoFiles = {
  "package.json": JSON.stringify({
    scripts: {
      test: "bun test",
      format: "biome format --write .",
      "format:check": "biome format .",
    },
  }),
  "biome.json": JSON.stringify({
    formatter: { indentStyle: "space" },
    javascript: {
      formatter: {
        jsxQuoteStyle: "double",
        quoteProperties: "asNeeded",
        trailingCommas: "all",
        semicolons: "asNeeded",
        arrowParentheses: "always",
        bracketSpacing: true,
        bracketSameLine: false,
      },
    },
    linter: { rules: { complexity: { noForEach: "error" } } },
  }),
  "bun.lock": "",
  ".github/workflows/bun-test.yml":
    "steps:\n  - uses: oven-sh/setup-bun@v2\n  - run: bun test",
  ".github/workflows/bun-typecheck.yml": "run: bunx tsc --noEmit",
  ".github/workflows/bun-formatcheck.yml": "run: bun run format:check",
}

export async function getCheckIds(source: CheckSource): Promise<string[]> {
  const report = await runChecks(source)
  return report.findings.map((finding) => finding.checkId)
}
