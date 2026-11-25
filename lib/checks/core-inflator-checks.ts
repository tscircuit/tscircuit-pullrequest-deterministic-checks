import ts from "typescript"
import type { Check, Finding } from "../types"

const checkId = "core/no-new-inflator-components"
const inflatorDir =
  "lib/components/primitive-components/Group/Subcircuit/inflators/"

function getPrimitiveComponentNames(file: ts.SourceFile): Set<string> {
  const names = new Set(["PrimitiveComponent"])
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const entry of bindings.elements) {
      if (entry.propertyName?.text === "PrimitiveComponent") {
        names.add(entry.name.text)
      }
    }
  }
  return names
}

interface InflatorWalk {
  file: ts.SourceFile
  primitiveNames: Set<string>
  addedLines: Set<number>
  findings: Finding[]
}

function visit(node: ts.Node, walk: InflatorWalk) {
  const { file, primitiveNames, addedLines, findings } = walk
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const base = node.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
    )?.types[0]?.expression
    const name = node.name?.text
    const isExistingSimulation =
      file.fileName === `${inflatorDir}inflateSimulation.ts` &&
      name === "InflatedSimulation"
    if (
      base &&
      ts.isIdentifier(base) &&
      primitiveNames.has(base.text) &&
      !isExistingSimulation
    ) {
      const start =
        file.getLineAndCharacterOfPosition((node.name ?? node).getStart(file))
          .line + 1
      const end = file.getLineAndCharacterOfPosition(base.getEnd()).line + 1
      for (let line = start; line <= end; line++) {
        if (!addedLines.has(line)) continue
        findings.push({
          checkId,
          level: "error",
          filePath: file.fileName,
          line,
          message: `Don't add a new PrimitiveComponent subclass (${name ?? "anonymous class"}) inside a subcircuit inflator. Use a shared restoration step for work that must wait for new IDs.`,
          why: "Shibo on Core #5888: do we really need a new component for this?",
        })
        break
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, walk))
}

export const coreInflatorChecks: Check[] = [
  {
    checkId,
    group: "diff",
    async run({ source, changedFiles }) {
      const repo = source.pr?.repoFullName ?? source.repoFullName
      if (repo?.toLowerCase() !== "tscircuit/core") return []

      const findings: Finding[] = []
      for (const { filePath, status, addedLines } of changedFiles) {
        if (
          status === "deleted" ||
          !filePath.startsWith(inflatorDir) ||
          !/\.tsx?$/.test(filePath) ||
          filePath.endsWith(".d.ts") ||
          addedLines.length === 0
        )
          continue
        const content = await source.readFile(filePath)
        if (content === null) continue
        const file = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.Latest,
          true,
        )
        visit(file, {
          file,
          primitiveNames: getPrimitiveComponentNames(file),
          addedLines: new Set(addedLines.map(({ line }) => line)),
          findings,
        })
      }
      return findings
    },
  },
]
