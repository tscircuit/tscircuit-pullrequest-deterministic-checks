import type { ChangedFile, Check, CheckContext, Finding } from "../types"
import { scanLineSegments } from "./scan-line-segments"

const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mts|cts)$/
const IGNORED_PATH_PATTERN =
  /(^|\/)(dist|node_modules|cosmos-export|\.next|build)\/|\.d\.ts$|\.snap$/
export const TEST_FILE_PATTERN = /(^|\/)tests?\/|\.test\.tsx?$|\.spec\.tsx?$/

export function isCheckedCodeFile(filePath: string): boolean {
  return (
    CODE_FILE_PATTERN.test(filePath) && !IGNORED_PATH_PATTERN.test(filePath)
  )
}

export function getCodeChanges(ctx: CheckContext): ChangedFile[] {
  return ctx.changedFiles.filter(
    (changedFile) =>
      changedFile.status !== "deleted" &&
      isCheckedCodeFile(changedFile.filePath),
  )
}

export function isCommentLine(text: string): boolean {
  return scanLineSegments(text).isPureComment
}

/** Strip string literals and line comments so patterns only hit code. */
export function getCodeOnly(text: string): string {
  return scanLineSegments(text).codeOnly
}

export function createLinePatternCheck(params: {
  checkId: string
  level: Finding["level"]
  pattern: RegExp
  message: string
  why?: string
  appliesToFile?: (filePath: string) => boolean
  /** "code" (default): strings and comments stripped. "raw": whole line. "comments": comment lines only. */
  matchOn?: "code" | "raw" | "comments"
}): Check {
  const matchOn = params.matchOn ?? "code"
  return {
    checkId: params.checkId,
    group: "diff",
    async run(ctx) {
      const findings: Finding[] = []
      for (const changedFile of getCodeChanges(ctx)) {
        if (params.appliesToFile && !params.appliesToFile(changedFile.filePath))
          continue
        for (const addedLine of changedFile.addedLines) {
          const segments = scanLineSegments(addedLine.text)
          if (matchOn === "code" && segments.isPureComment) continue
          if (matchOn === "comments" && segments.commentsOnly === "") continue
          const searchedText =
            matchOn === "code"
              ? segments.codeOnly
              : matchOn === "comments"
                ? segments.commentsOnly
                : addedLine.text
          if (params.pattern.test(searchedText)) {
            findings.push({
              checkId: params.checkId,
              level: params.level,
              filePath: changedFile.filePath,
              line: addedLine.line,
              message: `${params.message}: \`${addedLine.text.trim().slice(0, 120)}\``,
              why: params.why,
            })
          }
        }
      }
      return findings
    },
  }
}
