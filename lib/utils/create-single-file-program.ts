import ts from "typescript"

export function createSingleFileProgram(sourceFile: ts.SourceFile): ts.Program {
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    allowJs: true,
    target: ts.ScriptTarget.Latest,
  }
  const host = ts.createCompilerHost(options)
  // This rule only needs lexical bindings. Never follow imports or read files
  // from the machine running the checker.
  host.getSourceFile = (fileName) =>
    fileName === sourceFile.fileName ? sourceFile : undefined
  host.fileExists = (fileName) => fileName === sourceFile.fileName
  host.readFile = (fileName) =>
    fileName === sourceFile.fileName ? sourceFile.text : undefined
  return ts.createProgram([sourceFile.fileName], options, host)
}
