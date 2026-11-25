import ts from "typescript"
import type { Check, Finding } from "../types"
import { getCodeChanges } from "../utils/line-check-helpers"

const checkId = "handbook/review-undefined-signature"

function getUndefinedType(type: ts.TypeNode): ts.TypeNode | undefined {
  if (type.kind === ts.SyntaxKind.UndefinedKeyword) return type
  if (ts.isParenthesizedTypeNode(type)) return getUndefinedType(type.type)
  if (ts.isUnionTypeNode(type)) {
    for (const member of type.types) {
      const missing = getUndefinedType(member)
      if (missing) return missing
    }
  }
  if (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "Promise" &&
    type.typeArguments?.length === 1
  ) {
    return getUndefinedType(type.typeArguments[0])
  }
}

interface WalkContext {
  file: ts.SourceFile
  addedLines: Set<number>
  findings: Finding[]
}

function checkType(
  type: ts.TypeNode | undefined,
  params: WalkContext & { position: "input" | "return" },
) {
  if (!type) return
  const missing = getUndefinedType(type)
  if (!missing) return
  const { file, addedLines, findings, position } = params
  const first = file.getLineAndCharacterOfPosition(type.getStart(file)).line + 1
  const last = file.getLineAndCharacterOfPosition(type.getEnd()).line + 1
  const missingLine =
    file.getLineAndCharacterOfPosition(missing.getStart(file)).line + 1
  let changedLine: number | undefined
  for (let line = first; line <= last; line++) {
    if (!addedLines.has(line)) continue
    changedLine = line
    break
  }
  if (changedLine === undefined) return
  findings.push({
    checkId,
    level: "warn",
    filePath: file.fileName,
    line: addedLines.has(missingLine) ? missingLine : changedLine,
    message:
      position === "input"
        ? "This function input explicitly accepts undefined. If the function needs a value, handle absence at the caller and require the value here."
        : "This function can return undefined. Keep that for expected absence, such as a lookup miss; distinguish actual failures instead of silently treating them as missing.",
    why: "Shibo on Core #5888: an absent value is not a route length.",
  })
}

function visit(node: ts.Node, ctx: WalkContext) {
  if (ts.isFunctionLike(node)) {
    checkType(node.type, { ...ctx, position: "return" })
    for (const param of node.parameters) {
      checkType(param.type, { ...ctx, position: "input" })
      let type = param.type
      while (type && ts.isParenthesizedTypeNode(type)) type = type.type
      if (!type || !ts.isTypeLiteralNode(type)) continue
      for (const property of type.members) {
        if (ts.isPropertySignature(property)) {
          checkType(property.type, { ...ctx, position: "input" })
        }
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, ctx))
}

export const undefinedSignatureChecks: Check[] = [
  {
    checkId,
    group: "diff",
    async run(ctx) {
      const findings: Finding[] = []
      for (const { filePath, addedLines } of getCodeChanges(ctx)) {
        if (!/\.(?:ts|tsx|mts|cts)$/.test(filePath) || !addedLines.length)
          continue
        const content = await ctx.source.readFile(filePath)
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
