import type { Check, Finding } from "../types"
import {
  createLinePatternCheck,
  getCodeChanges,
  getCodeOnly,
} from "../utils/line-check-helpers"

const MAX_FILE_LINES = 300

const mapStringKey = createLinePatternCheck({
  checkId: "handbook/map-string-key",
  level: "error",
  pattern: /\bMap<\s*string\s*,/,
  message:
    "Map<string, …> is banned; use a named/branded key type (e.g. Map<PcbPortId, …>)",
  why: 'Shibo: "carries forward a Map<string, …> … against handbook guidance"',
})

const asAnyCast = createLinePatternCheck({
  checkId: "handbook/no-as-any",
  level: "error",
  pattern: /\bas\s+(any|unknown)\b/,
  message:
    "`as any` / `as unknown` disables type checking; fix the type instead",
})

const DECLARED_NAME_PATTERN =
  /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
const ALLOWED_UPPERCASE_RUNS = new Set([
  "toJSON",
  "innerHTML",
  "outerHTML",
  "XMLHttpRequest",
])

const googleStyleCasing: Check = {
  checkId: "handbook/casing",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of getCodeChanges(ctx)) {
      for (const addedLine of changedFile.addedLines) {
        for (const match of getCodeOnly(addedLine.text).matchAll(
          DECLARED_NAME_PATTERN,
        )) {
          const declaredName = match[1]!
          const isScreamingConstant = /^[A-Z0-9_]+$/.test(declaredName)
          if (isScreamingConstant || ALLOWED_UPPERCASE_RUNS.has(declaredName))
            continue
          if (
            /[A-Z]{2,}/.test(
              declaredName.replace(/[A-Z](?=[a-z])/g, (letter) =>
                letter.toLowerCase(),
              ),
            )
          ) {
            findings.push({
              checkId: this.checkId,
              level: "warn",
              filePath: changedFile.filePath,
              line: addedLine.line,
              message: `"${declaredName}": use google-style casing (myProfileId, fetchApiResponse, HttpClient)`,
            })
          }
        }
      }
    }
    return findings
  },
}

const bannedWords: Check = {
  checkId: "handbook/banned-words",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of getCodeChanges(ctx)) {
      for (const addedLine of changedFile.addedLines) {
        for (const match of getCodeOnly(addedLine.text).matchAll(
          DECLARED_NAME_PATTERN,
        )) {
          const declaredName = match[1]!
          if (
            /^(data|info|value|param)s?$|[a-z](Data|Info|Value|Param)s?$/.test(
              declaredName,
            )
          ) {
            findings.push({
              checkId: this.checkId,
              level: "warn",
              filePath: changedFile.filePath,
              line: addedLine.line,
              message: `"${declaredName}": data/info/value/param are banned words, say the thing`,
            })
          }
        }
      }
    }
    return findings
  },
}

const fileSize: Check = {
  checkId: "handbook/file-size",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of getCodeChanges(ctx)) {
      const netAddedLineCount =
        changedFile.addedLines.length - changedFile.removedLines.length
      // only blame a PR for a big file it created or grew
      if (changedFile.status !== "added" && netAddedLineCount <= 0) continue
      const content = await ctx.source.readFile(changedFile.filePath)
      const lineCount = content?.split("\n").length ?? 0
      if (lineCount > MAX_FILE_LINES) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: changedFile.filePath,
          message:
            changedFile.status === "added"
              ? `new file with ${lineCount} lines (> ${MAX_FILE_LINES}); split into focused modules`
              : `grew by ${netAddedLineCount} lines to ${lineCount} (> ${MAX_FILE_LINES}); put the new code in its own module`,
          why: 'Shibo: "some files are huge, are you following the tscircuit/handbook?"',
        })
      }
    }
    return findings
  },
}

export const handbookLineChecks: Check[] = [
  mapStringKey,
  asAnyCast,
  googleStyleCasing,
  bannedWords,
  fileSize,
]
