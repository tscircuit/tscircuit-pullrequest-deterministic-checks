import ts from "typescript"

export interface LineSegments {
  codeOnly: string
  commentsOnly: string
  isPureComment: boolean
}

const DIVISION_PRECEDING_TOKENS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.PrivateIdentifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.ObjectKeyword,
])

export function scanLineSegments(text: string): LineSegments {
  if (/^\s*\*(?!\*|\/)/.test(text)) {
    return { codeOnly: "", commentsOnly: text, isPureComment: true }
  }

  const codeParts: string[] = []
  const commentParts: string[] = []
  const leadingCloseMatch = text.match(/^\s*\*\//)
  const scanTarget = leadingCloseMatch
    ? text.slice(leadingCloseMatch[0].length)
    : text
  if (leadingCloseMatch) {
    commentParts.push(leadingCloseMatch[0])
  }

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    scanTarget,
  )
  const braceDepthStack: number[] = []
  let previousCodeToken: ts.SyntaxKind | undefined
  let hasCodeToken = false
  let token = scanner.scan()

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (
      token === ts.SyntaxKind.WhitespaceTrivia ||
      token === ts.SyntaxKind.NewLineTrivia
    ) {
      codeParts.push(scanner.getTokenText())
      token = scanner.scan()
      continue
    }
    if (token === ts.SyntaxKind.ShebangTrivia) {
      token = scanner.scan()
      continue
    }
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      commentParts.push(scanner.getTokenText())
      codeParts.push(" ")
      token = scanner.scan()
      continue
    }

    hasCodeToken = true

    if (
      (token === ts.SyntaxKind.SlashToken ||
        token === ts.SyntaxKind.SlashEqualsToken) &&
      (previousCodeToken === undefined ||
        !DIVISION_PRECEDING_TOKENS.has(previousCodeToken))
    ) {
      const positionAfterSlash = scanner.getTokenEnd()
      const slashText = scanner.getTokenText()
      const regexToken = scanner.reScanSlashToken()
      if (
        regexToken === ts.SyntaxKind.RegularExpressionLiteral &&
        !scanner.isUnterminated() &&
        scanTarget[scanner.getTokenEnd()] !== "/"
      ) {
        codeParts.push("/r/")
        previousCodeToken = ts.SyntaxKind.RegularExpressionLiteral
        token = scanner.scan()
        continue
      }
      scanner.setTextPos(positionAfterSlash)
      codeParts.push(slashText)
      previousCodeToken = token
      token = scanner.scan()
      continue
    }

    if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      codeParts.push('""')
      previousCodeToken = token
      token = scanner.scan()
      continue
    }

    if (token === ts.SyntaxKind.TemplateHead) {
      braceDepthStack.push(0)
      codeParts.push('"" + (')
      previousCodeToken = ts.SyntaxKind.OpenParenToken
      token = scanner.scan()
      continue
    }

    if (token === ts.SyntaxKind.OpenBraceToken && braceDepthStack.length > 0) {
      braceDepthStack[braceDepthStack.length - 1]! += 1
      codeParts.push("{")
      previousCodeToken = token
      token = scanner.scan()
      continue
    }

    if (token === ts.SyntaxKind.CloseBraceToken && braceDepthStack.length > 0) {
      const currentDepth = braceDepthStack[braceDepthStack.length - 1]!
      if (currentDepth > 0) {
        braceDepthStack[braceDepthStack.length - 1] = currentDepth - 1
        codeParts.push("}")
        previousCodeToken = token
        token = scanner.scan()
        continue
      }
      const resumedToken = scanner.reScanTemplateToken(false)
      if (resumedToken === ts.SyntaxKind.TemplateMiddle) {
        codeParts.push(') + "" + (')
        previousCodeToken = ts.SyntaxKind.OpenParenToken
      } else {
        braceDepthStack.pop()
        codeParts.push(') + ""')
        previousCodeToken = ts.SyntaxKind.TemplateTail
      }
      token = scanner.scan()
      continue
    }

    codeParts.push(scanner.getTokenText())
    previousCodeToken = token
    token = scanner.scan()
  }

  return {
    codeOnly: hasCodeToken ? codeParts.join("") : "",
    commentsOnly: commentParts.join(" "),
    isPureComment: !hasCodeToken && commentParts.length > 0,
  }
}
