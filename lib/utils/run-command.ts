export async function runCommand(
  argv: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<string> {
  // resolve against the current PATH and env (Bun.spawn otherwise uses the startup PATH)
  const [executableName, ...commandArgs] = argv
  const executablePath =
    Bun.which(executableName!, { PATH: process.env.PATH ?? "" }) ??
    executableName!
  const proc = Bun.spawn([executablePath, ...commandArgs], {
    cwd: options.cwd,
    env: process.env,
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
