import type { ChangedFile, Check, Finding } from "../types"

const MAX_CHANGED_PACKAGE_JSON_LINES = 1

function isPackageJson(changedFile: ChangedFile): boolean {
  return /(^|\/)package\.json$/.test(changedFile.filePath)
}

function countNonBlank(lines: string[]): number {
  return lines.filter((line) => line.trim() !== "").length
}

/**
 * A version bump is one line removed and one added, so it counts as one
 * changed line: the larger of the two sides.
 */
function countChangedLines(changedFile: ChangedFile): number {
  return Math.max(
    countNonBlank(changedFile.addedLines.map((addedLine) => addedLine.text)),
    countNonBlank(changedFile.removedLines),
  )
}

const packageJsonOneLine: Check = {
  checkId: "deps/package-json-one-line",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of ctx.changedFiles) {
      // a brand-new package.json (bootstrapping a repo) has to add many lines
      if (!isPackageJson(changedFile) || changedFile.status === "added") {
        continue
      }
      const changedLineCount = countChangedLines(changedFile)
      if (changedLineCount <= MAX_CHANGED_PACKAGE_JSON_LINES) continue
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: changedFile.filePath,
        line: changedFile.addedLines[0]?.line,
        message: `${changedLineCount} changed lines; a PR may change at most ${MAX_CHANGED_PACKAGE_JSON_LINES} line in package.json, so split the other changes into their own PRs`,
        why: 'Shibo: "there is redundant change in this pr … why did you bump circuit-json when you don\'t need to … this adds noise"',
      })
    }
    return findings
  },
}

export const packageJsonChecks: Check[] = [packageJsonOneLine]
