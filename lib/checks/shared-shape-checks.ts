import ts from "typescript"
import type { Check, CheckContext, Finding } from "../types"

const checkId = "schema/redeclared-shared-shape"
const primitiveKinds = new Map([
  [ts.SyntaxKind.NumberKeyword, "number"],
  [ts.SyntaxKind.StringKeyword, "string"],
  [ts.SyntaxKind.BooleanKeyword, "boolean"],
])
const primitiveSchemas = new Set(["number", "string", "boolean"])
const outputPreservingChecks = new Set([
  "finite",
  "int",
  "positive",
  "nonnegative",
  "min",
  "max",
])

interface Declaration {
  kind: "type" | "schema"
  name: string
  path: string
  line: number
  endLine: number
  exported: boolean
  fingerprint: string
}

interface SchemaImports {
  zod: Set<string>
  distance: Set<string>
}

function getSchemaImports(file: ts.SourceFile): SchemaImports {
  const imports: SchemaImports = { zod: new Set(), distance: new Set() }
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    if (clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings))
      continue
    const moduleName = statement.moduleSpecifier.text
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue
      const importedName = (element.propertyName ?? element.name).text
      if (moduleName === "zod" && importedName === "z") {
        imports.zod.add(element.name.text)
      }
      if (
        /^(?:src\/|(?:\.\.?\/)+)units(?:\/index)?$/.test(moduleName) &&
        importedName === "distance"
      ) {
        imports.distance.add(element.name.text)
      }
    }
  }
  return imports
}

function propertyName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
}

function fingerprint(fields: string[]): string | undefined {
  if (fields.length < 2 || new Set(fields).size !== fields.length) return
  return JSON.stringify(fields.sort())
}

/** Compare simple property signatures without conflating runtime validators and TS types. */
function typeShape(members: ts.NodeArray<ts.TypeElement>): string | undefined {
  const fields: string[] = []
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type) return
    const key = propertyName(member.name)
    const kind = primitiveKinds.get(member.type.kind)
    if (key === undefined || !kind) return
    const readonly = member.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
    )
    fields.push(JSON.stringify([key, kind, !!member.questionToken, !!readonly]))
  }
  return fingerprint(fields)
}

function schemaField(params: {
  value: ts.Expression
  imports: SchemaImports
}): string | undefined {
  const { imports } = params
  let value = params.value
  while (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression)
  ) {
    const { expression: receiver, name } = value.expression
    if (
      ts.isIdentifier(receiver) &&
      imports.zod.has(receiver.text) &&
      primitiveSchemas.has(name.text)
    ) {
      return name.text
    }
    if (!outputPreservingChecks.has(name.text)) return
    value = receiver
  }
  if (ts.isIdentifier(value) && imports.distance.has(value.text))
    return "number"
}

function schemaShape(params: {
  initializer: ts.Expression
  imports: SchemaImports
}): string | undefined {
  const { initializer, imports } = params
  if (!ts.isCallExpression(initializer)) return
  const callee = initializer.expression
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    !imports.zod.has(callee.expression.text) ||
    callee.name.text !== "object"
  ) {
    return
  }
  const [shape] = initializer.arguments
  if (!shape || !ts.isObjectLiteralExpression(shape)) return
  const fields: string[] = []
  for (const field of shape.properties) {
    if (!ts.isPropertyAssignment(field)) return
    const key = propertyName(field.name)
    const kind = schemaField({ value: field.initializer, imports })
    if (key === undefined || !kind) return
    fields.push(JSON.stringify([key, kind]))
  }
  return fingerprint(fields)
}

function declarations(params: {
  path: string
  content: string
}): Declaration[] {
  const file = ts.createSourceFile(
    params.path,
    params.content,
    ts.ScriptTarget.Latest,
    true,
  )
  const imports = getSchemaImports(file)
  const result: Declaration[] = []
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? (ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
      : false
    const line =
      file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1
    const endLine =
      file.getLineAndCharacterOfPosition(statement.getEnd()).line + 1
    const location = { path: params.path, line, endLine, exported }
    if (ts.isInterfaceDeclaration(statement)) {
      if (
        statement.typeParameters?.length ||
        statement.heritageClauses?.length
      ) {
        continue
      }
      const shape = typeShape(statement.members)
      if (shape) {
        result.push({
          ...location,
          kind: "type",
          name: statement.name.text,
          fingerprint: shape,
        })
      }
    } else if (
      ts.isTypeAliasDeclaration(statement) &&
      !statement.typeParameters?.length &&
      ts.isTypeLiteralNode(statement.type)
    ) {
      const shape = typeShape(statement.type.members)
      if (shape) {
        result.push({
          ...location,
          kind: "type",
          name: statement.name.text,
          fingerprint: shape,
        })
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue
        }
        const shape = schemaShape({
          initializer: declaration.initializer,
          imports,
        })
        if (shape) {
          result.push({
            ...location,
            kind: "schema",
            name: declaration.name.text,
            fingerprint: shape,
          })
        }
      }
    }
  }
  return result
}

function matchesShape(params: {
  existing: Declaration
  candidate: Declaration
}): boolean {
  const { existing, candidate } = params
  return (
    existing.kind === candidate.kind &&
    existing.fingerprint === candidate.fingerprint &&
    !(existing.path === candidate.path && existing.name === candidate.name)
  )
}

const sharedShapeCheck: Check = {
  checkId,
  group: "diff",
  async run(ctx: CheckContext) {
    if (ctx.source.repoFullName?.toLowerCase() !== "tscircuit/circuit-json") {
      return []
    }
    const addedByPath = new Map(
      ctx.changedFiles
        .filter((file) => file.status !== "deleted" && file.addedLines.length)
        .map((file) => [file.filePath, file.addedLines]),
    )
    const touches = (declaration: Declaration) =>
      addedByPath
        .get(declaration.path)
        ?.some(
          ({ line }) => line >= declaration.line && line <= declaration.endLine,
        ) ?? false
    const shapesByPath = new Map<string, Declaration[]>()
    const candidates: Declaration[] = []
    for (const path of [...addedByPath.keys()].sort()) {
      if (!/^src\/.*\.ts$/.test(path) || path.endsWith(".d.ts")) continue
      const content = await ctx.source.readFile(path)
      if (!content) continue
      const shapes = declarations({ path, content })
      shapesByPath.set(path, shapes)
      candidates.push(...shapes.filter(touches))
    }
    if (!candidates.length) return []

    const references: Declaration[] = []
    for (const path of [...ctx.allFiles].sort()) {
      if (!/^src\/common\/.*\.ts$/.test(path) || path.endsWith(".d.ts"))
        continue
      let shapes = shapesByPath.get(path)
      if (!shapes) {
        const content = await ctx.source.readFile(path)
        if (!content) continue
        shapes = declarations({ path, content })
      }
      references.push(
        ...shapes.filter((shape) => shape.exported && !touches(shape)),
      )
    }

    const findings: Finding[] = []
    for (const candidate of candidates) {
      const existing = references.find((reference) =>
        matchesShape({ existing: reference, candidate }),
      )
      if (!existing) continue
      const location = `${existing.name} (${existing.path}:${existing.line})`
      findings.push({
        checkId,
        level: "warn",
        filePath: candidate.path,
        line: candidate.line,
        message:
          candidate.kind === "schema"
            ? `${candidate.name} has the same output field shape as ${location}. Consider reusing it; verify input and validation constraints.`
            : `${candidate.name} has the same field shape as ${location}. Consider importing the existing type.`,
        why: 'Shibo: "why redefine point?" on Circuit JSON #1051',
      })
    }
    return findings
  },
}

export const sharedShapeChecks: Check[] = [sharedShapeCheck]
