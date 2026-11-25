import { expect, test } from "bun:test"
import { runChecks } from "lib/index"
import { addedFileDiff, createMemorySource } from "tests/fixtures/memory-source"

const addedBinaryDiff = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..1234567",
    `Binary files /dev/null and b/${path} differ`,
  ].join("\n")

function checkPngs(params: {
  body: string
  added?: string[]
  files?: Record<string, string>
  extraDiff?: string
}) {
  const { body, added = [], files = {}, extraDiff = "" } = params
  return runChecks(
    createMemorySource({
      files,
      diffText: [...added.map(addedBinaryDiff), extraDiff].join("\n"),
      pr: {
        body,
        repoFullName: "tscircuit/pcb-viewer",
        headRepoFullName: "contributor/pcb-viewer",
      },
    }),
    { groups: ["pr"], checkIdPrefixes: ["pr/description-only-png"] },
  )
}

test("flags each new description screenshot only once, even under __snapshots__", async () => {
  const added = [
    "tests/__snapshots__/phase-skew-view-menu.png",
    "tests/__snapshots__/phase-skew-canvas-after.png",
    "tests/__snapshots__/unlinked.png",
  ]
  const report = await checkPngs({
    added,
    body: [
      `![View menu](https://raw.githubusercontent.com/tscircuit/pcb-viewer/0a193f3/${added[0]})`,
      `[View menu again](./${added[0]})`,
      `<img src="https://github.com/contributor/pcb-viewer/blob/topic/phase-skew/${added[1]}?raw=true" />`,
    ].join("\n"),
  })
  expect(report.errorCount).toBe(0)
  expect(report.findings.map(({ filePath }) => filePath)).toEqual(
    added.slice(0, 2).sort(),
  )
})

test("ignores attachments, external images, pre-existing PNGs and non-PNGs", async () => {
  const report = await checkPngs({
    added: ["docs/demo.png", "docs/view.svg"],
    body: [
      "![demo](https://github.com/user-attachments/assets/demo.png)",
      "![demo](https://raw.githubusercontent.com/other/pcb-viewer/main/docs/demo.png)",
      "![old](docs/old.png)",
      "![svg](docs/view.svg)",
    ].join("\n"),
    extraDiff: [
      "diff --git a/docs/old.png b/docs/old.png",
      "index 1234567..7654321 100644",
      "Binary files a/docs/old.png and b/docs/old.png differ",
    ].join("\n"),
  })
  expect(report.warnCount).toBe(0)
})

test("exempts a concrete test asset but not a comment, similar name or demo fixture", async () => {
  const files = {
    "tests/overlay.test.ts": [
      'const testFile = new URL("./__snapshots__/golden.png", import.meta.url)',
      '// const screenshot = "./__snapshots__/demo.png"',
    ].join("\n"),
    "src/overlay.fixture.tsx": 'const img = "tests/__snapshots__/demo.png"',
  }
  const added = [
    "tests/__snapshots__/golden.png",
    "tests/__snapshots__/demo.png",
    "other/__snapshots__/golden.png",
  ]
  const report = await checkPngs({
    files,
    added,
    extraDiff: Object.entries(files)
      .map(([path, content]) => addedFileDiff(path, content))
      .join("\n"),
    body: added.map((path) => `![image](${path})`).join("\n"),
  })
  expect(report.findings.map(({ filePath }) => filePath)).toEqual([
    "other/__snapshots__/golden.png",
    "tests/__snapshots__/demo.png",
  ])
})

test("exempts an unchanged Playwright test's own screenshot directory", async () => {
  const image = "tests/overlay.spec.ts-snapshots/canvas-chromium-linux.png"
  const report = await checkPngs({
    files: {
      "tests/overlay.spec.ts":
        'await expect(page).toHaveScreenshot("canvas.png")',
    },
    added: [image],
    body: `![canvas][reference]\n\n[reference]: ${image}`,
  })
  expect(report.findings).toEqual([])
})
