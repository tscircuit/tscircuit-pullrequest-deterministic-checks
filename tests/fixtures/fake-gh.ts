import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface FakeGhResponse {
  /** Every one of these must appear in the space-joined gh arguments */
  argsInclude: string[]
  stdout: string
}

const fakeBinDir = mkdtempSync(join(tmpdir(), "fake-gh-"))
const responsesPath = join(fakeBinDir, "responses.json")
let isOnPath = false

/**
 * Puts a fake `gh` first on PATH that answers from canned responses, so
 * GitHub-backed sources can be tested without the network. Calling it again
 * replaces the responses (there is only ever one fake).
 */
export function installFakeGh(responses: FakeGhResponse[]): void {
  writeFileSync(responsesPath, JSON.stringify(responses))
  if (isOnPath) return
  const fakeGhPath = join(fakeBinDir, "gh")
  writeFileSync(
    fakeGhPath,
    `#!/usr/bin/env bun
const responses = await Bun.file(${JSON.stringify(responsesPath)}).json()
const joinedArgs = process.argv.slice(2).join(" ")
const response = responses.find((candidate) =>
  candidate.argsInclude.every((part) => joinedArgs.includes(part)),
)
if (!response) {
  console.error("fake gh: no response for " + joinedArgs)
  process.exit(1)
}
process.stdout.write(response.stdout)
`,
  )
  chmodSync(fakeGhPath, 0o755)
  process.env.PATH = `${fakeBinDir}:${process.env.PATH}`
  isOnPath = true
}

export function createGhPrView(params: {
  repoFullName: string
  number: number
  headSha: string
}): string {
  return JSON.stringify({
    url: `https://github.com/${params.repoFullName}/pull/${params.number}`,
    number: params.number,
    title: "",
    body: "",
    author: { login: "someone" },
    baseRefOid: "base000",
    headRefOid: params.headSha,
    headRepository: null,
    headRepositoryOwner: null,
    comments: [],
  })
}
