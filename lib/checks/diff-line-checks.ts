import type { AddedLine, Check, Finding } from "../types"
import {
  createLinePatternCheck,
  getCodeChanges,
  isCommentLine,
  TEST_FILE_PATTERN,
} from "../utils/line-check-helpers"

const useCircuitJsonUtil = createLinePatternCheck({
  checkId: "circuit-json/use-cju",
  level: "warn",
  pattern:
    /\.(filter|find|some|every)\(.*\.type\s*===?\s*["'`](pcb|schematic|source|cad|simulation)_/,
  matchOn: "raw",
  message:
    "manual circuit-json filtering; use circuit-json-util: `cju(circuitJson).pcb_trace.list()`",
  why: 'Shibo: "we use circuit-json-util for filtering circuit-json"',
})

const noLocalCircuitJsonTypes = createLinePatternCheck({
  checkId: "circuit-json/no-local-element-types",
  level: "warn",
  // object-shaped declarations only: `type PcbPortId = PcbPort["pcb_port_id"]` derives from circuit-json and is fine
  pattern:
    /^\s*(export\s+)?(interface\s+(Pcb|Schematic|Source|Cad)[A-Z]\w*\b|type\s+(Pcb|Schematic|Source|Cad)[A-Z]\w*\s*=\s*\{)|z\.literal\(\s*["'`](pcb|schematic|source|cad)_/,
  matchOn: "raw",
  message:
    "local type that looks like a circuit-json element; import it from circuit-json instead of redefining/overriding",
  why: 'Shibo: "drop the pre-existing local pcb_hole override and use circuit-json directly"',
})

const importTscircuitPackage = createLinePatternCheck({
  checkId: "imports/use-tscircuit-package",
  level: "warn",
  pattern:
    /from\s+["']@tscircuit\/(core|props|footprinter|schematic-symbols)["']/,
  matchOn: "raw",
  appliesToFile: (filePath) => TEST_FILE_PATTERN.test(filePath),
  message:
    'tests import individual @tscircuit/* packages; import from "tscircuit"',
  why: 'Shibo: "we stopped importing individual packages because they introduce technical debt"',
})

const testsMustRunInCi = createLinePatternCheck({
  checkId: "tests/must-run-in-ci",
  level: "error",
  pattern:
    // a skip, or a condition that can skip test code; `expect(existsSync(x))` is fine
    /\b(test|it|describe)\.(skip|skipIf|if|todo)\b|\bif\s*\(.*(\bexistsSync\(|process\.env\.(?!BUN_UPDATE_SNAPSHOTS)\w+)/,
  appliesToFile: (filePath) => TEST_FILE_PATTERN.test(filePath),
  message:
    "conditional/skipped test: it may silently not run in CI (missing models/files/env)",
  why: 'Shibo: "the models are not available as far as I can tell, this won\'t run on ci"',
})

const aiArtifacts = createLinePatternCheck({
  checkId: "comments/ai-artifacts",
  level: "error",
  pattern: /\b(codex|claude|chatgpt|copilot)\b|\bai[- ]review\b|\bas an ai\b/i,
  matchOn: "comments",
  message: "AI-tool text in source",
  why: "Shibo: \"I don't want your AI review for your AI, you gotta validate what it's saying\"",
})

const commentDensity: Check = {
  checkId: "comments/density",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of getCodeChanges(ctx)) {
      const commentLines = changedFile.addedLines.filter((addedLine) =>
        isCommentLine(addedLine.text),
      )
      const codeLines = changedFile.addedLines.filter(
        (addedLine) => addedLine.text.trim() !== "",
      )
      const commentRatio =
        codeLines.length === 0 ? 0 : commentLines.length / codeLines.length
      if (commentLines.length >= 4 && commentRatio > 0.15) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: changedFile.filePath,
          line: commentLines[0]!.line,
          message: `${commentLines.length} added comment lines (${Math.round(commentRatio * 100)}% of added lines); keep only comments you wrote and verified`,
          why: 'Shibo: "these comments don\'t help unless you wrote them"',
        })
      }
    }
    return findings
  },
}

type PackageName = string

const DEPENDENCY_LINE_PATTERN =
  /^\s*-?\s*["']?(@?[\w./-]+?)(?:@[^"':\s]+)?["']?\s*:\s*["']([^"']+)["']/
const INDIVIDUAL_TSCIRCUIT_PACKAGE_PATTERN =
  /^@tscircuit\/(core|props|footprinter|schematic-symbols|checks)$/

function getDependencyVersions(lines: string[]): Map<PackageName, string> {
  const versionsByName = new Map<PackageName, string>()
  for (const text of lines) {
    const match = text.match(DEPENDENCY_LINE_PATTERN)
    if (
      match &&
      !/^(version|name|description|main|types|module|type|license)$/.test(
        match[1]!,
      )
    ) {
      versionsByName.set(match[1]!, match[2]!)
    }
  }
  return versionsByName
}

const DEPENDENCY_SECTION_NAMES = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const

/** Versions declared in a package.json's dependency sections (not scripts, bin, etc). */
function getDeclaredDependencyVersions(
  packageJsonText: string | null,
): Map<PackageName, string> | null {
  if (!packageJsonText) return null
  try {
    const packageJson = JSON.parse(packageJsonText) as Partial<
      Record<(typeof DEPENDENCY_SECTION_NAMES)[number], Record<string, string>>
    >
    return new Map(
      DEPENDENCY_SECTION_NAMES.flatMap((sectionName) =>
        Object.entries(packageJson[sectionName] ?? {}),
      ),
    )
  } catch {
    return null
  }
}

const dependencyChanges: Check = {
  checkId: "deps",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of ctx.changedFiles) {
      if (
        !/(^|\/)(package\.json|pnpm-workspace\.yaml)$/.test(
          changedFile.filePath,
        )
      )
        continue
      const oldVersions = getDependencyVersions(changedFile.removedLines)
      const addedVersions = getDependencyVersions(
        changedFile.addedLines.map((addedLine: AddedLine) => addedLine.text),
      )
      const declaredVersions = changedFile.filePath.endsWith("package.json")
        ? getDeclaredDependencyVersions(
            await ctx.source.readFile(changedFile.filePath),
          )
        : null
      // only lines that really are dependency declarations in the new package.json
      const newVersions = declaredVersions
        ? new Map(
            [...addedVersions].filter(
              ([packageName, version]) =>
                declaredVersions.get(packageName) === version,
            ),
          )
        : addedVersions
      for (const [packageName, newVersion] of newVersions) {
        const oldVersion = oldVersions.get(packageName)
        if (oldVersion === newVersion) continue
        if (/^(https?:|github:|git\+|file:|link:)|\.tgz$/.test(newVersion)) {
          findings.push({
            checkId: "deps/no-url-deps",
            level: "error",
            filePath: changedFile.filePath,
            message: `${packageName} installed from ${newVersion.slice(0, 60)}…: publish to npm and depend on a version`,
            why: 'Shibo: "we don\'t do this"',
          })
          continue
        }
        if (INDIVIDUAL_TSCIRCUIT_PACKAGE_PATTERN.test(packageName)) {
          findings.push({
            checkId: "imports/use-tscircuit-package",
            level: "warn",
            filePath: changedFile.filePath,
            message: `${packageName} pinned individually: depend on "tscircuit" instead`,
            why: 'Shibo: "we import the tscircuit package, we stopped importing individual packages because they introduce technical debt and dependency conflicts"',
          })
          continue
        }
        findings.push({
          checkId: "deps/unneeded-bumps",
          level: "warn",
          filePath: changedFile.filePath,
          message: oldVersion
            ? `${packageName} bumped ${oldVersion} → ${newVersion}: is this PR unusable without it? if not, drop it`
            : `new dependency ${packageName}@${newVersion}: needed? (prefer the "tscircuit" package / existing deps)`,
          why: 'Shibo: "why did you bump circuit-json when you don\'t need to update types for this PR? this adds noise"',
        })
      }
    }
    return findings
  },
}

const reproAsTsx: Check = {
  checkId: "tests/repro-as-tsx",
  group: "diff",
  async run(ctx) {
    const findings: Finding[] = []
    for (const changedFile of ctx.changedFiles) {
      if (
        changedFile.status !== "added" ||
        !TEST_FILE_PATTERN.test(changedFile.filePath)
      )
        continue
      const handWrittenElementCount = changedFile.addedLines.filter(
        (addedLine) =>
          /type:\s*["'](pcb|schematic|source)_\w+["']/.test(addedLine.text),
      ).length
      if (handWrittenElementCount >= 5) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: changedFile.filePath,
          message: `${handWrittenElementCount} hand-written circuit-json elements; write the repro as TSX that shows the feature`,
          why: 'Shibo: "this repro is really bad. There is no showing of the desired feature, just random shapes."',
        })
      }
    }
    return findings
  },
}

export const diffLineChecks: Check[] = [
  useCircuitJsonUtil,
  noLocalCircuitJsonTypes,
  importTscircuitPackage,
  testsMustRunInCi,
  aiArtifacts,
  commentDensity,
  dependencyChanges,
  reproAsTsx,
]
