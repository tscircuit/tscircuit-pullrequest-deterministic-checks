import { posix } from "node:path"
import ts from "typescript"
import type { CheckSource } from "../types"

type NamedCall = { helper: string; values: Record<string, string> }
type PngRead = { property: string; prefix: string; suffix: string }

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node)
  ts.forEachChild(node, (child) => walk(child, visit))
}

function getNamedCalls(source: ts.SourceFile): NamedCall[] {
  const calls: NamedCall[] = []
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    const helper = node.expression.text
    if (
      !/^(?:expect|assert|match|compare)\w*(?:snapshot|golden|png)/i.test(
        helper,
      )
    )
      return
    const [arg] = node.arguments
    if (!arg || !ts.isObjectLiteralExpression(arg)) return
    const values: Record<string, string> = Object.create(null)
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        ts.isStringLiteralLike(prop.initializer)
      ) {
        values[prop.name.text] = prop.initializer.text
      }
    }
    if (Object.keys(values).length) calls.push({ helper, values })
  })
  return calls
}

function getPngReads(params: {
  helperFile: ts.SourceFile
  exportedName: string
}): PngRead[] {
  const { helperFile, exportedName } = params
  const helper = helperFile.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === exportedName,
  )
  const binding = helper?.parameters[0]?.name
  if (!helper?.body || !binding || !ts.isObjectBindingPattern(binding))
    return []

  // Only a single object field substituted into an import-relative PNG URL.
  const reads: PngRead[] = []
  const urls: Record<string, PngRead> = Object.create(null)
  const fileArgs = new Set<string>()
  walk(helper.body, (node) => {
    if (ts.isCallExpression(node)) {
      const [arg] = node.arguments
      if (
        arg &&
        ts.isIdentifier(arg) &&
        /^(?:Bun\.file|(?:fs\.)?readFile(?:Sync)?)$/.test(
          node.expression.getText(helperFile),
        )
      ) {
        fileArgs.add(arg.text)
      }
    }
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return
    const url = node.initializer
    if (
      !url ||
      !ts.isNewExpression(url) ||
      url.expression.getText(helperFile) !== "URL"
    )
      return
    const [path, base] = url.arguments ?? []
    if (
      !path ||
      !ts.isTemplateExpression(path) ||
      path.templateSpans.length !== 1 ||
      base?.getText(helperFile) !== "import.meta.url"
    ) {
      return
    }
    const span = path.templateSpans[0]!
    if (!ts.isIdentifier(span.expression) || !/\.png$/i.test(span.literal.text))
      return
    const field = binding.elements.find(
      ({ name }) =>
        ts.isIdentifier(name) &&
        name.text === span.expression.getText(helperFile),
    )
    if (!field || field.dotDotDotToken) return
    const key = field.propertyName ?? field.name
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return
    urls[node.name.text] = {
      property: key.text,
      prefix: path.head.text,
      suffix: span.literal.text,
    }
  })
  for (const name of fileArgs) {
    const read = urls[name]
    if (read) reads.push(read)
  }
  return reads
}

/** Follow a named import by one hop; never execute repository test code. */
export async function findNamedPngSnapshots(params: {
  test: ts.SourceFile
  source: CheckSource
  allFiles: Set<string>
}): Promise<string[]> {
  const { test, source, allFiles } = params
  const calls = getNamedCalls(test)
  if (!calls.length) return []
  const found: string[] = []
  for (const statement of test.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const { moduleSpecifier, importClause } = statement
    const bindings = importClause?.namedBindings
    if (
      !ts.isStringLiteral(moduleSpecifier) ||
      !moduleSpecifier.text.startsWith(".") ||
      !bindings ||
      !ts.isNamedImports(bindings)
    )
      continue
    const relevant = bindings.elements.filter(({ name }) =>
      calls.some(({ helper }) => helper === name.text),
    )
    if (!relevant.length) continue
    const base = posix.join(posix.dirname(test.fileName), moduleSpecifier.text)
    const path = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts"]
      .map((suffix) => base + suffix)
      .find((candidate) => allFiles.has(candidate))
    if (!path) continue
    const contents = await source.readFile(path)
    if (!contents) continue
    const helperFile = ts.createSourceFile(
      path,
      contents,
      ts.ScriptTarget.Latest,
    )
    for (const { name, propertyName } of relevant) {
      for (const read of getPngReads({
        helperFile,
        exportedName: (propertyName ?? name).text,
      })) {
        for (const { helper, values } of calls) {
          const value = values[read.property]
          if (helper === name.text && value !== undefined) {
            found.push(
              posix.join(
                posix.dirname(path),
                read.prefix + value + read.suffix,
              ),
            )
          }
        }
      }
    }
  }
  return found
}
