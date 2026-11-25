import ts from "typescript"
import type { Check, Finding } from "../types"

const checkId = "core/require-route-length-input"
const inflatorDir =
  "lib/components/primitive-components/Group/Subcircuit/inflators/"

function unwrapType(type: ts.TypeNode): ts.TypeNode {
  return ts.isParenthesizedTypeNode(type) ? unwrapType(type.type) : type
}

function isOptionalRouteLength(
  input: ts.ParameterDeclaration | ts.PropertySignature,
): boolean {
  if (!input.type) return false
  const type = unwrapType(input.type)
  const parts = ts.isUnionTypeNode(type) ? type.types.map(unwrapType) : [type]
  return (
    parts.some(
      (part) =>
        ts.isTypeReferenceNode(part) &&
        ts.isIdentifier(part.typeName) &&
        part.typeName.text === "SourceBusRouteLength",
    ) &&
    (input.questionToken !== undefined ||
      parts.some((part) => part.kind === ts.SyntaxKind.UndefinedKeyword))
  )
}

interface WalkContext {
  file: ts.SourceFile
  addedLines: Set<number>
  findings: Finding[]
}

function checkInput(
  input: ts.ParameterDeclaration | ts.PropertySignature,
  { file, addedLines, findings }: WalkContext,
) {
  if (!isOptionalRouteLength(input) || !input.type) return
  const first = file.getLineAndCharacterOfPosition(
    input.name.getStart(file),
  ).line
  const last = file.getLineAndCharacterOfPosition(input.type.getEnd()).line
  for (let line = first + 1; line <= last + 1; line++) {
    if (!addedLines.has(line)) continue
    findings.push({
      checkId,
      level: "error",
      filePath: file.fileName,
      line,
      message:
        "Require SourceBusRouteLength in the converter. Handle an absent value at the caller with an explicit undefined check so 0 is preserved.",
      why: "Shibo on Core #5888: an absent value is not a route length.",
    })
    break
  }
}

function visit(node: ts.Node, ctx: WalkContext) {
  if (ts.isFunctionLike(node)) {
    for (const param of node.parameters) {
      checkInput(param, ctx)
      if (!param.type || !ts.isTypeLiteralNode(param.type)) continue
      for (const property of param.type.members) {
        if (ts.isPropertySignature(property)) checkInput(property, ctx)
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, ctx))
}

export const coreRouteLengthChecks: Check[] = [
  {
    checkId,
    group: "diff",
    async run({ source, changedFiles }) {
      if (
        (source.pr?.repoFullName ?? source.repoFullName)?.toLowerCase() !==
        "tscircuit/core"
      )
        return []

      const findings: Finding[] = []
      for (const { filePath, status, addedLines } of changedFiles) {
        if (
          status === "deleted" ||
          !filePath.startsWith(inflatorDir) ||
          !filePath.endsWith(".ts") ||
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
          addedLines: new Set(addedLines.map(({ line }) => line)),
          findings,
        })
      }
      return findings
    },
  },
]
