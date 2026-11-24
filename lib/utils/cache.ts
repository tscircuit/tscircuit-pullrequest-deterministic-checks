import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Content-addressed disk cache. Only cache things that are immutable for their
 * key (file at a commit sha, diff between two shas, AST result for a content
 * hash). Mutable things (PR body, comments) pass a ttlMs instead.
 *
 * Bump CACHE_VERSION when a cached computation changes shape.
 */
const CACHE_VERSION = "v2"

export const cacheDir =
  process.env.PULLREQUEST_DETERMINISTIC_CHECKS_CACHE_DIR ??
  join(
    homedir(),
    ".cache",
    "tscircuit-pullrequest-deterministic-checks",
    CACHE_VERSION,
  )

const isCacheDisabled =
  process.env.PULLREQUEST_DETERMINISTIC_CHECKS_NO_CACHE === "1"

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function getEntryPath(cacheKey: string): string {
  const keyHash = hashText(cacheKey)
  return join(cacheDir, keyHash.slice(0, 2), `${keyHash}.json`)
}

interface CacheEntry<T> {
  cacheKey: string
  storedAtMs: number
  payload: T
}

function readEntry<T>(entryPath: string): CacheEntry<T> | null {
  if (isCacheDisabled || !existsSync(entryPath)) return null
  try {
    return JSON.parse(readFileSync(entryPath, "utf8")) as CacheEntry<T>
  } catch {
    // a corrupt entry (e.g. from an interrupted write) is just a cache miss
    return null
  }
}

export async function cached<T>(
  params: { cacheKey: string; ttlMs?: number },
  compute: () => Promise<T>,
): Promise<T> {
  const entryPath = getEntryPath(params.cacheKey)
  const entry = readEntry<T>(entryPath)
  if (entry) {
    const isFresh =
      params.ttlMs === undefined || Date.now() - entry.storedAtMs < params.ttlMs
    if (entry.cacheKey === params.cacheKey && isFresh) return entry.payload
  }
  const payload = await compute()
  if (!isCacheDisabled) {
    mkdirSync(join(entryPath, ".."), { recursive: true })
    const newEntry: CacheEntry<T> = {
      cacheKey: params.cacheKey,
      storedAtMs: Date.now(),
      payload,
    }
    // write then rename, so readers never see a half-written entry
    const temporaryPath = `${entryPath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporaryPath, JSON.stringify(newEntry))
    renameSync(temporaryPath, entryPath)
  }
  return payload
}
