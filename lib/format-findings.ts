import type { Finding } from "./types"

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return "✓ no findings"
  const explainedCheckIds = new Set<string>()
  return findings
    .map((finding) => {
      const location = finding.filePath
        ? `${finding.filePath}${finding.line ? `:${finding.line}` : ""}`
        : "(PR)"
      const marker = finding.level === "error" ? "✗" : "!"
      const isFirstOfCheck = !explainedCheckIds.has(finding.checkId)
      explainedCheckIds.add(finding.checkId)
      const why = finding.why && isFirstOfCheck ? `\n    ↳ ${finding.why}` : ""
      return `${marker} [${finding.checkId}] ${location}\n    ${finding.message}${why}`
    })
    .join("\n")
}
