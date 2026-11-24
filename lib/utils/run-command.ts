export async function runCommand(
  argv: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<string> {
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0 && !options.allowFailure) {
    throw new Error(`${argv.join(" ")} failed (${exitCode}): ${stderr.trim()}`)
  }
  return exitCode === 0 ? stdout : ""
}
