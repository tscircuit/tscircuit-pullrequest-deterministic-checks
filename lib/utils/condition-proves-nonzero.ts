import ts from "typescript"
import { getNumericConstantValue } from "./get-numeric-constant-value"
import { isGuardedDivisorTarget } from "./is-guarded-divisor-target"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function conditionProvesNonzero(params: {
  condition: ts.Expression
  whenTrue: boolean
  declaration: ts.VariableDeclaration
  checker: ts.TypeChecker
}): boolean {
  const condition = unwrapNumericExpression(params.condition)

  if (
    ts.isPrefixUnaryExpression(condition) &&
    condition.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operand = unwrapNumericExpression(condition.operand)
    if (
      isGuardedDivisorTarget({
        expression: operand,
        declaration: params.declaration,
        checker: params.checker,
      })
    ) {
      return !params.whenTrue
    }
    return conditionProvesNonzero({
      ...params,
      condition: operand,
      whenTrue: !params.whenTrue,
    })
  }

  if (ts.isBinaryExpression(condition)) {
    const operator = condition.operatorToken.kind
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return params.whenTrue
        ? conditionProvesNonzero({ ...params, condition: condition.left }) ||
            conditionProvesNonzero({ ...params, condition: condition.right })
        : conditionProvesNonzero({ ...params, condition: condition.left }) &&
            conditionProvesNonzero({ ...params, condition: condition.right })
    }
    if (operator === ts.SyntaxKind.BarBarToken) {
      return params.whenTrue
        ? conditionProvesNonzero({ ...params, condition: condition.left }) &&
            conditionProvesNonzero({ ...params, condition: condition.right })
        : conditionProvesNonzero({ ...params, condition: condition.left }) ||
            conditionProvesNonzero({ ...params, condition: condition.right })
    }

    const leftIsTarget = isGuardedDivisorTarget({
      expression: condition.left,
      declaration: params.declaration,
      checker: params.checker,
    })
    const rightIsTarget =
      !leftIsTarget &&
      isGuardedDivisorTarget({
        expression: condition.right,
        declaration: params.declaration,
        checker: params.checker,
      })
    if (!leftIsTarget && !rightIsTarget) return false

    const constantValue = getNumericConstantValue({
      expression: leftIsTarget ? condition.right : condition.left,
      checker: params.checker,
    })
    if (constantValue === undefined) return false

    // Both `d` and `Math.abs(d)` equal 0 when `d === 0`, so substituting 0 for
    // the guarded target tests whether zero can enter the selected branch.
    const leftAtZero = leftIsTarget ? 0 : constantValue
    const rightAtZero = leftIsTarget ? constantValue : 0
    let zeroSatisfies: boolean
    switch (operator) {
      case ts.SyntaxKind.EqualsEqualsEqualsToken:
        zeroSatisfies = leftAtZero === rightAtZero
        break
      case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        zeroSatisfies = leftAtZero !== rightAtZero
        break
      case ts.SyntaxKind.GreaterThanToken:
        zeroSatisfies = leftAtZero > rightAtZero
        break
      case ts.SyntaxKind.GreaterThanEqualsToken:
        zeroSatisfies = leftAtZero >= rightAtZero
        break
      case ts.SyntaxKind.LessThanToken:
        zeroSatisfies = leftAtZero < rightAtZero
        break
      case ts.SyntaxKind.LessThanEqualsToken:
        zeroSatisfies = leftAtZero <= rightAtZero
        break
      default:
        return false
    }
    return zeroSatisfies !== params.whenTrue
  }

  return false
}
