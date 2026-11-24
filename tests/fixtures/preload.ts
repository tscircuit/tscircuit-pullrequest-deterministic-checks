import { afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const testCacheDir = mkdtempSync(join(tmpdir(), "tscircuit-checks-test-"))
Bun.env.PULLREQUEST_DETERMINISTIC_CHECKS_CACHE_DIR = testCacheDir
Bun.env.PULLREQUEST_DETERMINISTIC_CHECKS_NO_CACHE = "0"

afterAll(() => rmSync(testCacheDir, { recursive: true, force: true }))
