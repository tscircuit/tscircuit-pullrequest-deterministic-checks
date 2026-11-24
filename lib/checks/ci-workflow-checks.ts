import type { Check, Finding } from "../types"
import { SHIBO_PLOP } from "./repo-tooling-checks"

const ciWorkflows: Check = {
  checkId: "tooling/ci",
  group: "repo",
  async run(ctx) {
    const findings: Finding[] = []
    const workflowPaths = ctx.allFiles.filter((filePath) =>
      /^\.github\/workflows\/.+\.ya?ml$/.test(filePath),
    )
    const workflowTexts = await Promise.all(
      workflowPaths.map(async (filePath) => ({
        filePath,
        workflowText: (await ctx.source.readFile(filePath)) ?? "",
      })),
    )
    for (const { filePath, workflowText } of workflowTexts) {
      const workflowCode = workflowText.replace(/^\s*#.*$/gm, "")
      // plop's own release templates use setup-node + `npm install -g pver`, so only flag real package-manager use
      if (
        /pnpm\/action-setup|\bpnpm\b|\byarn\b|\bnpm (run|test)\b/.test(
          workflowCode,
        )
      ) {
        findings.push({
          checkId: this.checkId,
          level: "error",
          filePath,
          message:
            "workflow runs pnpm/yarn/npm scripts: plop workflows use oven-sh/setup-bun + `bun install` / `bun test`",
          why: SHIBO_PLOP,
        })
      }
    }
    const hasTests = ctx.allFiles.some((filePath) =>
      /\.test\.tsx?$/.test(filePath),
    )
    const runsBunTest = workflowTexts.some(({ workflowText }) =>
      /\bbun (run )?test\b/.test(workflowText),
    )
    if (hasTests && !runsBunTest) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: ".github/workflows",
        message:
          "no workflow runs `bun test`: add plop's bun-test.yml so tests run in CI",
        why: 'Shibo: "so these tests will only run locally or what?"',
      })
    }
    const expectedWorkflows: [RegExp, string][] = [
      [/bunx tsc --noEmit/, "bun-typecheck.yml"],
      [/format:check/, "bun-formatcheck.yml"],
    ]
    for (const [pattern, templateName] of expectedWorkflows) {
      if (
        !workflowTexts.some(({ workflowText }) => pattern.test(workflowText))
      ) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: ".github/workflows",
          message: `no workflow matching plop's ${templateName}`,
          why: SHIBO_PLOP,
        })
      }
    }
    return findings
  },
}

export const ciWorkflowChecks: Check[] = [ciWorkflows]
