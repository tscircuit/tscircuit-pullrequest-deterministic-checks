import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Content-addressed disk cache. Only cache things that are immutable for their
 * key (file at a commit sha, diff between two shas, AST result for a content
 * hash). Mutable things (PR body, comments) pass a ttlMs instead.
 *
 * Bump CACHE_VERSION when a cached computation changes shape.
 */
const CACHE_VERSION = "v1"

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

export async function cached<T>(
  params: { cacheKey: string; ttlMs?: number },
  compute: () => Promise<T>,
): Promise<T> {
  const entryPath = getEntryPath(params.cacheKey)
  if (!isCacheDisabled && existsSync(entryPath)) {
    const entry = JSON.parse(readFileSync(entryPath, "utf8")) as CacheEntry<T>
    const isFresh =
      params.ttlMs === undefined || Date.now() - entry.storedAtMs < params.ttlMs
    if (entry.cacheKey === params.cacheKey && isFresh) return entry.payload
  }
  const payload = await compute()
  if (!isCacheDisabled) {
    mkdirSync(join(entryPath, ".."), { recursive: true })
    const entry: CacheEntry<T> = {
      cacheKey: params.cacheKey,
      storedAtMs: Date.now(),
      payload,
    }
    writeFileSync(entryPath, JSON.stringify(entry))
  }
  return payload
}
