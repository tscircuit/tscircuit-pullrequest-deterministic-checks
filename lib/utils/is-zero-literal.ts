import ts from "typescript"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function isZeroLiteral(expression: ts.Expression): boolean {
  expression = unwrapNumericExpression(expression)
  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.PlusToken ||
      expression.operator === ts.SyntaxKind.MinusToken)
  ) {
    expression = unwrapNumericExpression(expression.operand)
  }
  return ts.isNumericLiteral(expression) && Number(expression.text) === 0
}
