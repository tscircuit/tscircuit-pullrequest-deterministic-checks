import ts from "typescript"
import type { Check, Finding } from "../types"

const checkId = "schema/missing-measurement-unit"
const measurementExamples: Record<string, string> = {
  skew: "length skew in mm and time skew in ps are different quantities",
  delay: "for example, _ns if the value is in nanoseconds",
  latency: "for example, _ns if the value is in nanoseconds",
  length_difference: "for example, _mm if the value is in millimeters",
  trace_length: "for example, _mm if the value is in millimeters",
  frequency: "for example, _hz if the value is in hertz",
  voltage: "for example, _v if the value is in volts",
  current: "for example, _a if the value is in amperes",
  resistance: "for example, _ohm if the value is in ohms",
  capacitance: "for example, _pf if the value is in picofarads",
  inductance: "for example, _nh if the value is in nanohenries",
}
const numericSchemaModifiers = new Set([
  "default",
  "finite",
  "gt",
  "gte",
  "int",
  "lt",
  "lte",
  "max",
  "min",
  "negative",
  "nonnegative",
  "nonpositive",
  "nullable",
  "nullish",
  "optional",
  "positive",
  "safe",
])

function getZodNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "zod" ||
      statement.importClause?.isTypeOnly
    )
      continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamespaceImport(bindings))
      names.add(bindings.name.text)
    if (bindings && ts.isNamedImports(bindings)) {
      for (const entry of bindings.elements) {
        if (
          !entry.isTypeOnly &&
          (entry.propertyName ?? entry.name).text === "z"
        ) {
          names.add(entry.name.text)
        }
      }
    }
  }
  return names
}

function isZodCall(params: {
  node: ts.Node
  names: Set<string>
  method: string
}) {
  const { node, names, method } = params
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    names.has(node.expression.expression.text) &&
    node.expression.name.text === method
  )
}

function isNumericSchema(value: ts.Expression, names: Set<string>): boolean {
  while (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression)
  ) {
    if (isZodCall({ node: value, names, method: "number" })) return true
    if (!numericSchemaModifiers.has(value.expression.name.text)) return false
    value = value.expression.expression
  }
  return false
}

function getNumericProperty(node: ts.Node, names: Set<string>) {
  if (
    ts.isPropertySignature(node) &&
    node.type?.kind === ts.SyntaxKind.NumberKeyword
  ) {
    return node.name
  }
  if (
    ts.isPropertyAssignment(node) &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.arguments[0] === node.parent &&
    isZodCall({ node: node.parent.parent, names, method: "object" }) &&
    isNumericSchema(node.initializer, names)
  ) {
    return node.name
  }
}

function getMeasurementWarning(field: string): string | undefined {
  const name = field.replace(/([a-z\d])([A-Z])/g, "$1_$2").toLowerCase()
  for (const [measurement, example] of Object.entries(measurementExamples)) {
    if (name === measurement || name.endsWith(`_${measurement}`)) {
      return `\`${field}\` is numeric but has no unit in its name. Add the actual unit as a suffix (${example}).`
    }
  }
}

interface FieldWalk {
  file: ts.SourceFile
  zodNames: Set<string>
  addedLines: Set<number>
  seen: Set<string>
  findings: Finding[]
}

function visit(node: ts.Node, walk: FieldWalk) {
  const { file, zodNames, addedLines, seen, findings } = walk
  const field = getNumericProperty(node, zodNames)
  if (field && (ts.isIdentifier(field) || ts.isStringLiteral(field))) {
    const line =
      file.getLineAndCharacterOfPosition(field.getStart(file)).line + 1
    const key = JSON.stringify([line, field.text])
    const message = getMeasurementWarning(field.text)
    if (message && addedLines.has(line) && !seen.has(key)) {
      seen.add(key)
      findings.push({
        checkId,
        level: "warn",
        filePath: file.fileName,
        line,
        message,
        why: "Seve on circuit-json#1051: unit of skew?",
      })
    }
  }
  ts.forEachChild(node, (child) => visit(child, walk))
}

export const measurementUnitChecks: Check[] = [
  {
    checkId,
    group: "diff",
    async run({ source, changedFiles }) {
      const repo = source.pr?.repoFullName ?? source.repoFullName
      if (repo?.toLowerCase() !== "tscircuit/circuit-json") return []
      const findings: Finding[] = []
      for (const { filePath, status, addedLines } of changedFiles) {
        if (
          status === "deleted" ||
          !/^src\/.*\.ts$/.test(filePath) ||
          /\.d\.ts$/.test(filePath) ||
          addedLines.length === 0
        )
          continue
        const content = await source.readFile(filePath)
        if (content === null) continue
        const file = ts.createSourceFile(
          filePath,
          content,
          ts.ScriptTarget.Latest,
          true,
        )
        visit(file, {
          file,
          zodNames: getZodNames(file),
          addedLines: new Set(addedLines.map(({ line }) => line)),
          seen: new Set(),
          findings,
        })
      }
      return findings
    },
  },
]
