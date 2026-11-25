import { posix } from "node:path"
import ts from "typescript"
import type { Check, CheckContext, PrMetadata } from "../types"
import { findNamedPngSnapshots } from "../utils/named-png-snapshots"

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|e2e)\/|\.(?:test|spec)\.[^.]+$/
const JS_EXTENSION = /\.[cm]?[jt]sx?$/i
const PNG_EXTENSION = /\.png$/i

function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function findAddedPngsInDescription(params: {
  pr: PrMetadata
  addedPngs: string[]
}): Set<string> {
  const { pr, addedPngs } = params
  const body = pr.body.replace(/<!--[\s\S]*?-->/g, "")
  const repos = new Set(
    [pr.repoFullName, pr.headRepoFullName].map((name) => name?.toLowerCase()),
  )
  const matches = new Set<string>()
  // Plain URLs are auto-linked by GitHub. Also read relative Markdown and HTML
  // destinations, including reference definitions and angle-wrapped paths.
  const destinations = [
    ...body.matchAll(/https?:\/\/[^\s<>"')\]]+/gi),
    ...body.matchAll(
      /\]\(\s*(?:<([^>]+)>|([^\s)]+))|^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|([^\s]+))|\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)')/gim,
    ),
  ]
  for (const match of destinations) {
    const destination = match.slice(1).find(Boolean) ?? match[0]
    if (/^https?:\/\//i.test(destination)) {
      let url: URL
      try {
        url = new URL(destination)
      } catch {
        continue
      }
      const path = decodePath(url.pathname)
      if (!path || !PNG_EXTENSION.test(path)) continue
      const [, owner, repo, ...rest] = path.split("/")
      if (!repos.has(`${owner}/${repo}`.toLowerCase())) continue
      if (url.hostname === "github.com") {
        if (rest[0] !== "blob" && rest[0] !== "raw") continue
        rest.shift()
      } else if (url.hostname !== "raw.githubusercontent.com") {
        continue
      }
      // A branch can contain slashes. Prefer the longest exact file suffix if
      // two added files share a suffix. Keep matching pinned pre-review URLs.
      const file = addedPngs.find((filePath) =>
        rest.join("/").endsWith(`/${filePath}`),
      )
      if (file) matches.add(file)
    } else if (!/^(?:\/\/|[a-z][a-z\d+.-]*:)/i.test(destination)) {
      const path = decodePath(destination.split(/[?#]/)[0] ?? "")
      if (!path) continue
      const file = posix.normalize(path.replace(/^\//, ""))
      if (addedPngs.includes(file)) matches.add(file)
    }
  }
  return matches
}

function isRelevantTest(params: {
  testFile: string
  changed: Set<string>
  images: Set<string>
}): boolean {
  const { testFile, changed, images } = params
  if (!TEST_PATH.test(testFile) || !JS_EXTENSION.test(testFile)) return false
  if (changed.has(testFile)) return true
  const stem = testFile.replace(/(?:\.(?:test|spec))?\.[^.]+$/, "")
  return [...images].some((image) => {
    if (image.startsWith(`${testFile}-snapshots/`)) return true
    const name = posix.basename(image).toLowerCase()
    return (
      posix.dirname(image).replace(/\/__snapshots__$/, "") ===
        posix.dirname(testFile) &&
      (name === `${posix.basename(stem).toLowerCase()}.png` ||
        name.startsWith(`${posix.basename(stem).toLowerCase()}-`) ||
        name.startsWith(`${posix.basename(stem).toLowerCase()}.`))
    )
  })
}

function removeTestImages(params: {
  parsed: ts.SourceFile
  images: Set<string>
}) {
  const { parsed, images } = params
  const testFile = parsed.fileName
  function removePath(path: string) {
    if (!PNG_EXTENSION.test(path)) return
    images.delete(posix.join(posix.dirname(testFile), path))
    if (!path.startsWith(".")) images.delete(posix.normalize(path))
  }
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) removePath(node.text)
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : node.expression.getText(parsed)
      const strings = node.arguments.filter(ts.isStringLiteralLike)
      if (name === "join" || name === "resolve") {
        if (
          strings.length === node.arguments.length ||
          (strings.length === node.arguments.length - 1 &&
            /^(?:__dirname|import\.meta\.dirname|process\.cwd\(\))$/.test(
              node.arguments[0]?.getText(parsed) ?? "",
            ))
        ) {
          removePath(strings.map((arg) => arg.text).join("/"))
        }
      }
      if (name === "toHaveScreenshot") {
        for (const image of images) {
          if (image.startsWith(`${testFile}-snapshots/`)) images.delete(image)
        }
      }
      if (/^to(?:HaveScreenshot|Match(?:Png|Image)?Snapshot)$/.test(name)) {
        for (const { text } of strings) {
          if (!PNG_EXTENSION.test(text)) continue
          images.delete(
            posix.join(posix.dirname(testFile), "__snapshots__", text),
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
}

export const prDescriptionPngCheck: Check = {
  checkId: "pr/description-only-png",
  group: "pr",
  async run(ctx: CheckContext) {
    const { pr } = ctx.source
    if (!pr) return []
    const addedPngs = ctx.changedFiles
      .filter(
        ({ status, filePath }) =>
          status === "added" && PNG_EXTENSION.test(filePath),
      )
      .map(({ filePath }) => filePath)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))
    if (!addedPngs.length) return []
    const images = findAddedPngsInDescription({ pr, addedPngs })
    if (!images.size) return []
    const changed = new Set(ctx.changedFiles.map(({ filePath }) => filePath))
    const tests = ctx.allFiles.filter((testFile) =>
      isRelevantTest({ testFile, changed, images }),
    )
    // Bound concurrent GitHub content requests; skip reads once all candidates
    // are accounted for. Binary file contents are never required.
    const allFiles = new Set(ctx.allFiles)
    for (let index = 0; index < tests.length && images.size; index += 8) {
      await Promise.all(
        tests.slice(index, index + 8).map(async (testFile) => {
          const contents = await ctx.source.readFile(testFile)
          if (!contents) return
          const parsed = ts.createSourceFile(
            testFile,
            contents,
            ts.ScriptTarget.Latest,
          )
          removeTestImages({ parsed, images })
          if (!images.size) return
          const snapshots = await findNamedPngSnapshots({
            test: parsed,
            source: ctx.source,
            allFiles,
          })
          for (const snapshot of snapshots) images.delete(snapshot)
        }),
      )
    }
    return [...images].map((filePath) => ({
      checkId: this.checkId,
      level: "warn" as const,
      filePath,
      message:
        "new PNG is linked in the PR description but no test reference was found; attach it to the PR instead if it is only visual evidence",
      why: 'Mustafa: "i dont think we add the cosmos fixture snapshots to the codebase"',
    }))
  },
}
