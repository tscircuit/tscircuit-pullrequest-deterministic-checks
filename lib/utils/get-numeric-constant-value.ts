import ts from "typescript"
import { getConstDeclaration } from "./get-const-declaration"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function getNumericConstantValue(params: {
  expression: ts.Expression
  checker: ts.TypeChecker
}) {
  let node = unwrapNumericExpression(params.expression)
  let sign = 1
  const seen = new Set<ts.VariableDeclaration>()

  while (true) {
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken)
    ) {
      if (node.operator === ts.SyntaxKind.MinusToken) sign = -sign
      node = unwrapNumericExpression(node.operand)
      continue
    }
    if (ts.isIdentifier(node)) {
      const declaration = getConstDeclaration({
        node,
        checker: params.checker,
      })
      if (!declaration?.initializer || seen.has(declaration)) return undefined
      seen.add(declaration)
      node = unwrapNumericExpression(declaration.initializer)
      continue
    }
    break
  }

  if (!ts.isNumericLiteral(node)) return undefined
  const parsed = sign * Number(node.text)
  return Number.isFinite(parsed) ? parsed : undefined
}
