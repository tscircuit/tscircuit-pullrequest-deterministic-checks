import ts from "typescript"
import type { Check, CheckContext, Finding } from "../types"
import { cached, hashText } from "../utils/cache"
import { isCheckedCodeFile } from "../utils/line-check-helpers"

/** Bump when the AST rules change so cached results are recomputed. */
const AST_RULES_VERSION = "1"

interface AstViolation {
  checkId:
    | "handbook/two-parameter-rule"
    | "handbook/no-named-closures"
    | "handbook/entrypoint-pollution"
  line: number
  message: string
}

type FunctionLikeNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration

function isFunctionLike(node: ts.Node): node is FunctionLikeNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function getFunctionName(node: FunctionLikeNode): string {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  if (
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text
  }
  return "<anonymous>"
}

/** Callbacks passed straight to a call (`.reduce((acc, x, i) => …)`) have API-dictated arity. */
function isInlineCallback(node: FunctionLikeNode): boolean {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
  )
}

function getEnclosingFunction(node: ts.Node): FunctionLikeNode | undefined {
  let ancestor = node.parent
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor
    ancestor = ancestor.parent
  }
  return undefined
}

function isReactComponentName(functionName: string): boolean {
  return /^[A-Z]/.test(functionName) || /^use[A-Z]/.test(functionName)
}

interface AstWalkContext {
  filePath: string
  sourceFile: ts.SourceFile
  violations: AstViolation[]
}

function getLine(node: ts.Node, ctx: AstWalkContext): number {
  return (
    ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart(ctx.sourceFile))
      .line + 1
  )
}

function checkFunctionNode(node: FunctionLikeNode, ctx: AstWalkContext) {
  const functionName = getFunctionName(node)
  if (node.parameters.length > 2 && !isInlineCallback(node)) {
    ctx.violations.push({
      checkId: "handbook/two-parameter-rule",
      line: getLine(node, ctx),
      message: `${functionName}() takes ${node.parameters.length} params; use one named-params object, or (params, ctx)`,
    })
  }
  const enclosingFunction = getEnclosingFunction(node)
  const isNamedDeclaration =
    ts.isFunctionDeclaration(node) ||
    ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isVariableDeclaration(node.parent))
  if (!enclosingFunction || !isNamedDeclaration) return
  const enclosingName = getFunctionName(enclosingFunction)
  const isInsideComponent =
    ctx.filePath.endsWith("x") && isReactComponentName(enclosingName)
  const isInsideTestCallback =
    /\.test\.tsx?$/.test(ctx.filePath) && enclosingName === "<anonymous>"
  if (isInsideComponent || isInsideTestCallback) return
  ctx.violations.push({
    checkId: "handbook/no-named-closures",
    line: getLine(node, ctx),
    message: `${functionName}() is a named closure inside ${enclosingName}(); hoist it to module scope`,
  })
}

function visitNode(node: ts.Node, ctx: AstWalkContext) {
  if (isFunctionLike(node)) checkFunctionNode(node, ctx)
  ts.forEachChild(node, (child) => visitNode(child, ctx))
}

function isFunctionStatement(statement: ts.Statement): boolean {
  return (
    ts.isFunctionDeclaration(statement) ||
    (ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) =>
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)),
      ))
  )
}

function findAstViolations(params: {
  filePath: string
  content: string
}): AstViolation[] {
  const sourceFile = ts.createSourceFile(
    params.filePath,
    params.content,
    ts.ScriptTarget.Latest,
    true,
    params.filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const ctx: AstWalkContext = {
    filePath: params.filePath,
    sourceFile,
    violations: [],
  }
  visitNode(sourceFile, ctx)

  if (/(^|\/)index\.tsx?$/.test(params.filePath)) {
    const topLevelFunctionCount =
      sourceFile.statements.filter(isFunctionStatement).length
    if (topLevelFunctionCount > 2) {
      ctx.violations.push({
        checkId: "handbook/entrypoint-pollution",
        line: 1,
        message: `entrypoint defines ${topLevelFunctionCount} functions; move implementations to sibling modules and import them`,
      })
    }
  }
  return ctx.violations
}

function getCachedAstViolations(params: {
  filePath: string
  content: string
}): Promise<AstViolation[]> {
  return cached(
    {
      cacheKey: `ast:${AST_RULES_VERSION}:${params.filePath.endsWith("x")}:${/index\.tsx?$/.test(params.filePath)}:${hashText(params.content)}`,
    },
    async () => findAstViolations(params),
  )
}

/**
 * Parses each changed file in full but only reports violations that start on
 * an added line, so you are not blamed for code you did not touch.
 */
const astHandbookChecks: Check = {
  checkId: "handbook/ast",
  group: "diff",
  async run(ctx: CheckContext) {
    const findings: Finding[] = []
    for (const changedFile of ctx.changedFiles) {
      if (
        changedFile.status === "deleted" ||
        !isCheckedCodeFile(changedFile.filePath)
      )
        continue
      const content = await ctx.source.readFile(changedFile.filePath)
      if (!content) continue
      const addedLineNumbers = new Set(
        changedFile.addedLines.map((addedLine) => addedLine.line),
      )
      const violations = await getCachedAstViolations({
        filePath: changedFile.filePath,
        content,
      })
      for (const violation of violations) {
        const isEntrypointRule =
          violation.checkId === "handbook/entrypoint-pollution"
        if (!isEntrypointRule && !addedLineNumbers.has(violation.line)) continue
        findings.push({
          checkId: violation.checkId,
          level: isEntrypointRule ? "warn" : "error",
          filePath: changedFile.filePath,
          line: violation.line,
          message: violation.message,
          why:
            violation.checkId === "handbook/entrypoint-pollution"
              ? "tscircuit/handbook: avoid polluting entrypoint files"
              : 'Shibo: "a three-parameter nested helper, both against handbook guidance"',
        })
      }
    }
    return findings
  },
}

export const astChecks: Check[] = [astHandbookChecks]
