import type { ChangedFile } from "../types"

/** Parse `git diff` / `gh pr diff` output into per-file added/removed lines. */
export function parseUnifiedDiff(diffText: string): ChangedFile[] {
  const changedFiles: ChangedFile[] = []
  let current: ChangedFile | null = null
  let newLineNumber = 0

  for (const rawLine of diffText.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/^diff --git a\/(.+?) b\/(.+)$/)
      current = {
        filePath: match?.[2] ?? "",
        status: "modified",
        addedLines: [],
        removedLines: [],
      }
      changedFiles.push(current)
      continue
    }
    if (!current) continue
    if (rawLine.startsWith("new file mode")) current.status = "added"
    else if (rawLine.startsWith("deleted file mode")) current.status = "deleted"
    else if (rawLine.startsWith("rename to ")) current.status = "renamed"
    else if (rawLine.startsWith("+++ ") || rawLine.startsWith("--- ")) continue
    else if (rawLine.startsWith("@@")) {
      const match = rawLine.match(/\+(\d+)/)
      newLineNumber = match ? Number(match[1]) : 0
    } else if (rawLine.startsWith("+")) {
      current.addedLines.push({ line: newLineNumber, text: rawLine.slice(1) })
      newLineNumber++
    } else if (rawLine.startsWith("-")) {
      current.removedLines.push(rawLine.slice(1))
    } else if (rawLine.startsWith(" ")) {
      newLineNumber++
    }
  }
  return changedFiles.filter((changedFile) => changedFile.filePath !== "")
}
