import { expect, test } from "bun:test"
import { packageName } from "lib/index"

test("the package entrypoint loads", () => {
  expect(packageName).toBe("tscircuit-pullrequest-deterministic-checks")
})
