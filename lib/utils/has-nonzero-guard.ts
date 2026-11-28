import ts from "typescript"
import { conditionProvesNonzero } from "./condition-proves-nonzero"
import { getConstDeclaration } from "./get-const-declaration"
import { unwrapNumericExpression } from "./unwrap-numeric-expression"

export function hasNonzeroGuard(params: {
  division: ts.BinaryExpression
  checker: ts.TypeChecker
}): boolean {
  const divisor = unwrapNumericExpression(params.division.right)
  if (!ts.isIdentifier(divisor)) return false
  const declaration = getConstDeclaration({
    node: divisor,
    checker: params.checker,
  })
  if (!declaration) return false
  const binding = { declaration, checker: params.checker }

  let child: ts.Node = params.division
  for (
    let parent = child.parent;
    parent;
    child = parent, parent = parent.parent
  ) {
    if (ts.isFunctionLike(parent)) break
    let condition: ts.Expression | undefined
    let whenTrue = false
    if (
      ts.isIfStatement(parent) &&
      (parent.thenStatement === child || parent.elseStatement === child)
    ) {
      condition = parent.expression
      whenTrue = parent.thenStatement === child
    } else if (
      ts.isConditionalExpression(parent) &&
      (parent.whenTrue === child || parent.whenFalse === child)
    ) {
      condition = parent.condition
      whenTrue = parent.whenTrue === child
    } else if (ts.isBinaryExpression(parent) && parent.right === child) {
      const operator = parent.operatorToken.kind
      if (
        operator === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator === ts.SyntaxKind.BarBarToken
      ) {
        condition = parent.left
        whenTrue = operator === ts.SyntaxKind.AmpersandAmpersandToken
      }
    } else if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      for (const statement of parent.statements) {
        if (statement === child) break
        if (!ts.isIfStatement(statement) || statement.elseStatement) continue
        let branch = statement.thenStatement
        if (ts.isBlock(branch) && branch.statements.length === 1)
          branch = branch.statements[0]!
        if (
          (ts.isReturnStatement(branch) ||
            ts.isThrowStatement(branch) ||
            ts.isContinueStatement(branch) ||
            ts.isBreakStatement(branch)) &&
          conditionProvesNonzero({
            ...binding,
            condition: statement.expression,
            whenTrue: false,
          })
        )
          return true
      }
    }
    if (
      condition &&
      conditionProvesNonzero({ ...binding, condition, whenTrue })
    )
      return true
  }
  return false
}
