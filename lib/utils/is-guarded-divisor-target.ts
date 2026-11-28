import ts from "typescript"
import { getConstDeclaration } from "./get-const-declaration"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function isGuardedDivisorTarget(params: {
  expression: ts.Expression
  declaration: ts.VariableDeclaration
  checker: ts.TypeChecker
}): boolean {
  let target = unwrapNumericExpression(params.expression)
  if (
    ts.isCallExpression(target) &&
    target.arguments.length === 1 &&
    ts.isPropertyAccessExpression(target.expression) &&
    ts.isIdentifier(target.expression.expression) &&
    target.expression.expression.text === "Math" &&
    target.expression.name.text === "abs"
  ) {
    target = unwrapNumericExpression(target.arguments[0]!)
  }
  return (
    ts.isIdentifier(target) &&
    getConstDeclaration({ node: target, checker: params.checker }) ===
      params.declaration
  )
}
