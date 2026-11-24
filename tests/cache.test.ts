import { expect, test } from "bun:test"
import { join } from "node:path"
import { cacheDir, cached, hashText } from "lib/utils/cache"

test("reuses a disk entry for the same key and separates different keys", async () => {
  const cacheKey = "test:disk-entry"
  const keyHash = hashText(cacheKey)
  const entryPath = join(cacheDir, keyHash.slice(0, 2), `${keyHash}.json`)

  expect(await cached({ cacheKey }, async () => ({ count: 1 }))).toEqual({
    count: 1,
  })
  expect(await Bun.file(entryPath).json()).toMatchObject({
    cacheKey,
    payload: { count: 1 },
  })
  expect(await cached({ cacheKey }, async () => ({ count: 2 }))).toEqual({
    count: 1,
  })
  expect(
    await cached({ cacheKey: "test:other-entry" }, async () => ({ count: 2 })),
  ).toEqual({ count: 2 })
})

test("recomputes an expired entry", async () => {
  const cacheKey = "test:expired-entry"
  await cached({ cacheKey }, async () => "old")

  expect(await cached({ cacheKey, ttlMs: 0 }, async () => "fresh")).toBe(
    "fresh",
  )
  expect(await cached({ cacheKey }, async () => "unused")).toBe("fresh")
})
