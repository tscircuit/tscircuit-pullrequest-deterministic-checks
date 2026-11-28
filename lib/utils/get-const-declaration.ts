import ts from "typescript"

export function getConstDeclaration(params: {
  node: ts.Identifier
  checker: ts.TypeChecker
}): ts.VariableDeclaration | null {
  const declaration = params.checker.getSymbolAtLocation(
    params.node,
  )?.valueDeclaration
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
  ) {
    return declaration
  }
  return null
}
