import ts from "typescript"
import { getConstDeclaration } from "./get-const-declaration"
import { isZeroLiteral } from "./is-zero-literal"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function conditionProvesNonzero(params: {
  condition: ts.Expression
  whenTrue: boolean
  declaration: ts.VariableDeclaration
  checker: ts.TypeChecker
}): boolean {
  const condition = unwrapNumericExpression(params.condition)
  if (!ts.isBinaryExpression(condition)) return false
  const left = unwrapNumericExpression(condition.left)
  const right = unwrapNumericExpression(condition.right)
  const zeroOnLeft = isZeroLiteral(left)
  const candidate = zeroOnLeft ? right : left
  if (
    !(zeroOnLeft || isZeroLiteral(right)) ||
    !ts.isIdentifier(candidate) ||
    getConstDeclaration({ node: candidate, checker: params.checker }) !==
      params.declaration
  ) {
    return false
  }
  // Either strict inequality excludes zero when true. Its inclusive counterpart
  // excludes zero when false, regardless of which side the zero is written on.
  switch (condition.operatorToken.kind) {
    case ts.SyntaxKind.ExclamationEqualsEqualsToken:
    case ts.SyntaxKind.GreaterThanToken:
    case ts.SyntaxKind.LessThanToken:
      return params.whenTrue
    case ts.SyntaxKind.EqualsEqualsEqualsToken:
    case ts.SyntaxKind.GreaterThanEqualsToken:
    case ts.SyntaxKind.LessThanEqualsToken:
      return !params.whenTrue
    default:
      return false
  }
}
