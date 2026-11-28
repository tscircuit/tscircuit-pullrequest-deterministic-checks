import ts from "typescript"
import type { Check, Finding } from "../types"
import { createSingleFileProgram } from "../utils/create-single-file-program"
import { hasNonzeroGuard } from "../utils/has-nonzero-guard"
import { getCodeChanges, TEST_FILE_PATTERN } from "../utils/line-check-helpers"
import { looksLikeZeroCapableDivisor } from "../utils/looks-like-zero-capable-divisor"

const checkId = "correctness/possible-division-by-zero"

export const divisionByZeroChecks: Check[] = [
  {
    checkId,
    group: "diff",
    async run(ctx) {
      const findings: Finding[] = []
      for (const change of getCodeChanges(ctx)) {
        if (
          !change.addedLines.length ||
          TEST_FILE_PATTERN.test(change.filePath)
        )
          continue
        const contents = await ctx.source.readFile(change.filePath)
        if (!contents?.includes("/")) continue
        const sourceFile = ts.createSourceFile(
          change.filePath,
          contents,
          ts.ScriptTarget.Latest,
          true,
        )
        let checker: ts.TypeChecker | undefined
        const pending: ts.Node[] = [sourceFile]
        while (pending.length) {
          const node = pending.pop()!
          ts.forEachChild(node, (child) => {
            pending.push(child)
          })
          if (
            ts.isBinaryExpression(node) &&
            (node.operatorToken.kind === ts.SyntaxKind.SlashToken ||
              node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken)
          ) {
            const firstLine =
              sourceFile.getLineAndCharacterOfPosition(
                node.operatorToken.getStart(sourceFile),
              ).line + 1
            const lastLine =
              sourceFile.getLineAndCharacterOfPosition(node.right.getEnd() - 1)
                .line + 1
            const touched = change.addedLines.find(
              ({ line }) => line >= firstLine && line <= lastLine,
            )
            if (touched) {
              checker ??= createSingleFileProgram(sourceFile).getTypeChecker()
              if (
                looksLikeZeroCapableDivisor({ node: node.right, checker }) &&
                !hasNonzeroGuard({ division: node, checker })
              ) {
                findings.push({
                  checkId,
                  level: "warn",
                  filePath: change.filePath,
                  line: touched.line,
                  message: `Divisor \`${node.right.getText(sourceFile).replace(/\s+/g, " ").slice(0, 100)}\` can be zero. Check for zero before dividing, and choose an explicit fallback.`,
                  why: "this divides by distance without guarding against zero-length segments",
                })
              }
            }
          }
        }
      }
      return findings
    },
  },
]
