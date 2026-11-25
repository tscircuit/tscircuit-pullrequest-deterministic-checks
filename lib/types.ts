export type FindingLevel = "error" | "warn"

export interface Finding {
  /** Stable check id, e.g. "handbook/map-string-key" */
  checkId: string
  level: FindingLevel
  message: string
  filePath?: string
  line?: number
  /** Which reviewer comment this check exists to preempt */
  why?: string
}

export interface AddedLine {
  line: number
  text: string
}

export interface ChangedFile {
  filePath: string
  status: "added" | "modified" | "deleted" | "renamed"
  /** For renames: the path before the rename */
  previousFilePath?: string
  addedLines: AddedLine[]
  removedLines: string[]
}

export interface PrMetadata {
  url: string
  repoFullName: string
  headRepoFullName?: string
  number: number
  title: string
  body: string
  authorLogin: string
  baseSha: string
  headSha: string
  /** Bodies of comments the PR author left on their own PR */
  authorCommentBodies: string[]
}

/**
 * Everything a check can look at. Local checkouts and remote PRs both
 * implement this, so every check runs the same way against either.
 */
export interface CheckSource {
  kind: "local" | "pr"
  /** "owner/repo" when known */
  repoFullName?: string
  /** Immutable id of the state being checked (commit sha, or sha + dirty hash) */
  revisionKey: string
  listFiles(): Promise<string[]>
  readFile(filePath: string): Promise<string | null>
  getChangedFiles(): Promise<ChangedFile[]>
  pr?: PrMetadata
}

export interface CheckContext {
  source: CheckSource
  changedFiles: ChangedFile[]
  allFiles: string[]
}

export interface Check {
  checkId: string
  group: "repo" | "diff" | "pr"
  run(ctx: CheckContext): Promise<Finding[]>
}
