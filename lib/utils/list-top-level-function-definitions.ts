import ts from "typescript"

type FunctionImplementation =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction

interface Definition {
  node: FunctionImplementation
  definition: ts.Node
}

export function listTopLevelFunctionDefinitions(
  sourceFile: ts.SourceFile,
): Definition[] {
  const definitions: Definition[] = []
  const candidates: { expression: ts.Expression; definition: ts.Node }[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      definitions.push({ node: statement, definition: statement })
    } else if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations
      for (const [index, declaration] of declarations.entries()) {
        if (declaration.initializer) {
          candidates.push({
            expression: declaration.initializer,
            definition: index === 0 ? statement : declaration,
          })
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      candidates.push({
        expression: statement.expression,
        definition: statement,
      })
    }
  }
  for (const { expression, definition } of candidates) {
    let node = expression
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      definitions.push({ node, definition })
    }
  }
  return definitions.sort((a, b) => a.definition.pos - b.definition.pos)
}
