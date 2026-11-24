import type { ChangedFile } from "../types"

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
}

/** Git quotes paths with special characters as C strings, e.g. "lib/caf\303\251.ts". */
export function unquoteGitPath(rawPath: string): string {
  if (!rawPath.startsWith('"') || !rawPath.endsWith('"')) return rawPath
  const quotedBody = rawPath.slice(1, -1)
  const pathBytes: number[] = []
  for (let index = 0; index < quotedBody.length; index++) {
    const character = quotedBody[index]!
    if (character !== "\\") {
      pathBytes.push(...new TextEncoder().encode(character))
      continue
    }
    const octalDigits = quotedBody.slice(index + 1, index + 4)
    if (/^[0-7]{3}$/.test(octalDigits)) {
      pathBytes.push(Number.parseInt(octalDigits, 8))
      index += 3
    } else {
      const escapedCharacter = quotedBody[index + 1] ?? ""
      pathBytes.push(
        C_ESCAPES[escapedCharacter] ?? escapedCharacter.charCodeAt(0),
      )
      index += 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(pathBytes))
}

/** "b/lib/x.ts" or "\"b/lib/x.ts\"" → "lib/x.ts"; "/dev/null" → null */
function getPathFromFileHeader(headerPath: string): string | null {
  const unquotedPath = unquoteGitPath(headerPath.trim())
  if (unquotedPath === "/dev/null") return null
  return unquotedPath.replace(/^[ab]\//, "")
}

/** Fallback for diffs without ---/+++ lines (binary or mode-only changes). */
function getPathFromDiffGitLine(diffGitLine: string): string {
  const pathPair = diffGitLine.slice("diff --git ".length)
  const quotedMatch = pathPair.match(/ ("b\/.*")$/)
  if (quotedMatch) return getPathFromFileHeader(quotedMatch[1]!) ?? ""
  const plainMatch = pathPair.match(/^a\/(.+) b\/(.+)$/)
  return plainMatch?.[2] ?? ""
}

interface HunkState {
  newLineNumber: number
  remainingOldLines: number
  remainingNewLines: number
}

function parseHunkHeader(hunkHeader: string): HunkState {
  const match = hunkHeader.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  return {
    newLineNumber: Number(match?.[2] ?? 0),
    remainingOldLines: Number(match?.[1] ?? 1),
    remainingNewLines: Number(match?.[3] ?? 1),
  }
}

/**
 * Parse `git diff` / GitHub diff output into per-file added/removed lines.
 * Hunk lengths from the @@ header decide where a hunk ends, so content lines
 * like "++ counter" are never mistaken for file headers.
 */
export function parseUnifiedDiff(diffText: string): ChangedFile[] {
  const changedFiles: ChangedFile[] = []
  let current: ChangedFile | null = null
  let hunk: HunkState | null = null

  for (const rawLine of diffText.split("\n")) {
    const isInsideHunk =
      hunk !== null &&
      (hunk.remainingOldLines > 0 || hunk.remainingNewLines > 0)
    if (current && hunk && isInsideHunk) {
      if (rawLine.startsWith("+")) {
        current.addedLines.push({
          line: hunk.newLineNumber,
          text: rawLine.slice(1),
        })
        hunk.newLineNumber++
        hunk.remainingNewLines--
      } else if (rawLine.startsWith("-")) {
        current.removedLines.push(rawLine.slice(1))
        hunk.remainingOldLines--
      } else if (!rawLine.startsWith("\\")) {
        hunk.newLineNumber++
        hunk.remainingOldLines--
        hunk.remainingNewLines--
      }
      continue
    }
    if (rawLine.startsWith("diff --git ")) {
      current = {
        filePath: getPathFromDiffGitLine(rawLine),
        status: "modified",
        addedLines: [],
        removedLines: [],
      }
      hunk = null
      changedFiles.push(current)
      continue
    }
    if (!current) continue
    if (rawLine.startsWith("@@")) hunk = parseHunkHeader(rawLine)
    else if (rawLine.startsWith("new file mode")) current.status = "added"
    else if (rawLine.startsWith("deleted file mode")) current.status = "deleted"
    else if (rawLine.startsWith("rename to ")) current.status = "renamed"
    else if (rawLine.startsWith("+++ ")) {
      current.filePath =
        getPathFromFileHeader(rawLine.slice(4)) ?? current.filePath
    } else if (rawLine.startsWith("--- ") && current.filePath === "") {
      current.filePath = getPathFromFileHeader(rawLine.slice(4)) ?? ""
    }
  }
  return changedFiles.filter((changedFile) => changedFile.filePath !== "")
}
