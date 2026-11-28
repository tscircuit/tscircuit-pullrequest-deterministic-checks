import ts from "typescript"
import { getConstDeclaration } from "./get-const-declaration"
import { isZeroLiteral } from "./is-zero-literal"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

const measurementNames = new Set([
  "distance",
  "distancesquared",
  "hypot",
  "norm",
  "magnitude",
])

export function looksLikeZeroCapableDivisor(params: {
  node: ts.Expression
  checker: ts.TypeChecker
}): boolean {
  let node = unwrapNumericExpression(params.node)
  const seen = new Set<ts.VariableDeclaration>()
  while (ts.isIdentifier(node)) {
    const declaration = getConstDeclaration({ node, checker: params.checker })
    if (!declaration?.initializer || seen.has(declaration)) return false
    seen.add(declaration)
    node = unwrapNumericExpression(declaration.initializer)
  }
  if (isZeroLiteral(node)) return true
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text === "length" || node.name.text === "size"
  }
  if (!ts.isCallExpression(node)) return false
  const callee = unwrapNumericExpression(node.expression)
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : undefined
  return (
    name !== undefined &&
    measurementNames.has(name.replaceAll("_", "").toLowerCase())
  )
}
