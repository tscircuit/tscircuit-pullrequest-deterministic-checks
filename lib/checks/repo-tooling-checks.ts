import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Check, CheckContext, Finding } from "../types"

const plopBiomeConfig = JSON.parse(
  readFileSync(join(import.meta.dir, "../assets/plop-biome.json"), "utf8"),
)

interface PackageJson {
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function parseJsonOrNull<T>(jsonText: string): T | null {
  try {
    return JSON.parse(jsonText) as T
  } catch {
    return null
  }
}

/** Invalid JSON yields null here; tooling/bun-only reports it once. */
async function readPackageJson(ctx: CheckContext): Promise<PackageJson | null> {
  const packageJsonText = await ctx.source.readFile("package.json")
  return packageJsonText ? parseJsonOrNull<PackageJson>(packageJsonText) : null
}

function getAllDependencyNames(packageJson: PackageJson): string[] {
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]
}

export const SHIBO_PLOP =
  'Shibo: "find tscircuit/plop which have our conventional ci files"'

const noForeignLockfiles: Check = {
  checkId: "tooling/bun-only",
  group: "repo",
  async run(ctx) {
    const findings: Finding[] = []
    const foreignFiles = [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package-lock.json",
      "yarn.lock",
      ".npmrc",
    ].filter((filePath) => ctx.allFiles.includes(filePath))
    for (const filePath of foreignFiles) {
      findings.push({
        checkId: this.checkId,
        level: filePath === ".npmrc" ? "warn" : "error",
        filePath,
        message: `${filePath} present: tscircuit repos use bun only (bun.lock)`,
        why: 'Shibo: "pnpm :(" / "it\'s not using bun test still?"',
      })
    }
    const packageJsonText = await ctx.source.readFile("package.json")
    if (packageJsonText && !parseJsonOrNull(packageJsonText)) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "package.json",
        message: "package.json is not valid JSON",
      })
    }
    const packageJson = await readPackageJson(ctx)
    if (
      packageJson?.packageManager &&
      !packageJson.packageManager.startsWith("bun")
    ) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "package.json",
        message: `packageManager is "${packageJson.packageManager}", expected bun`,
      })
    }
    for (const [scriptName, scriptCommand] of Object.entries(
      packageJson?.scripts ?? {},
    )) {
      if (/\b(pnpm|yarn|npx|npm run)\b/.test(scriptCommand)) {
        findings.push({
          checkId: this.checkId,
          level: "error",
          filePath: "package.json",
          message: `script "${scriptName}" uses a non-bun runner: ${scriptCommand}`,
        })
      }
    }
    return findings
  },
}

const bunTestRunner: Check = {
  checkId: "tooling/bun-test",
  group: "repo",
  async run(ctx) {
    const packageJson = await readPackageJson(ctx)
    if (!packageJson) return []
    const findings: Finding[] = []
    const foreignRunners = getAllDependencyNames(packageJson).filter((name) =>
      ["vitest", "jest", "ava", "mocha", "@jest/globals", "ts-jest"].includes(
        name,
      ),
    )
    for (const runnerName of foreignRunners) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "package.json",
        message: `${runnerName} dependency: use bun test`,
        why: 'Shibo: "it\'s not using bun test still?"',
      })
    }
    const testScript = packageJson.scripts?.test
    if (testScript && !/\bbun test\b/.test(testScript)) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "package.json",
        message: `"test" script is "${testScript}", expected "bun test"`,
      })
    }
    return findings
  },
}

const biomeFormatter: Check = {
  checkId: "tooling/biome",
  group: "repo",
  async run(ctx) {
    const findings: Finding[] = []
    const why =
      'Shibo: "you added custom formatting tools? we use biome and an established config in @tscircuit/plop"'
    const foreignConfigs = ctx.allFiles.filter((filePath) =>
      /^(\.prettierrc.*|prettier\.config\.\w+|\.eslintrc.*|eslint\.config\.\w+|\.editorconfig|dprint\.json)$/.test(
        filePath,
      ),
    )
    for (const filePath of foreignConfigs) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath,
        message: `${filePath}: tscircuit uses biome, not other formatters/linters`,
        why,
      })
    }
    const packageJson = await readPackageJson(ctx)
    if (packageJson) {
      for (const name of getAllDependencyNames(packageJson)) {
        if (/^(prettier|eslint|dprint|@typescript-eslint\/.+)$/.test(name)) {
          findings.push({
            checkId: this.checkId,
            level: "error",
            filePath: "package.json",
            message: `${name} dependency: use @biomejs/biome with the plop config`,
            why,
          })
        }
      }
      for (const [scriptName, scriptCommand] of Object.entries(
        packageJson.scripts ?? {},
      )) {
        if (
          /^(format|lint)/.test(scriptName) &&
          !/\bbiome\b/.test(scriptCommand)
        ) {
          findings.push({
            checkId: this.checkId,
            level: "error",
            filePath: "package.json",
            message: `script "${scriptName}" does not use biome: ${scriptCommand}`,
            why,
          })
        }
      }
      if (!packageJson.scripts?.["format:check"]) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: "package.json",
          message:
            'no "format:check" script (plop\'s bun-formatcheck.yml runs `bun run format:check`)',
        })
      }
    }
    const biomeText = await ctx.source.readFile("biome.json")
    if (!biomeText) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "biome.json",
        message:
          "biome.json missing: copy it from tscircuit/plop (template-files/biome.json)",
        why,
      })
      return findings
    }
    const biomeConfig = parseJsonOrNull<typeof plopBiomeConfig>(biomeText)
    if (!biomeConfig) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        filePath: "biome.json",
        message: "biome.json is not valid JSON",
      })
      return findings
    }
    const comparedKeys: [string, unknown, unknown][] = [
      [
        "formatter.indentStyle",
        biomeConfig.formatter?.indentStyle,
        plopBiomeConfig.formatter.indentStyle,
      ],
      ...Object.entries(plopBiomeConfig.javascript.formatter).map(
        ([key, plopSetting]): [string, unknown, unknown] => [
          `javascript.formatter.${key}`,
          biomeConfig.javascript?.formatter?.[key],
          plopSetting,
        ],
      ),
      [
        "linter.rules.complexity.noForEach",
        biomeConfig.linter?.rules?.complexity?.noForEach,
        "error",
      ],
    ]
    for (const [settingPath, repoSetting, plopSetting] of comparedKeys) {
      if (JSON.stringify(repoSetting) !== JSON.stringify(plopSetting)) {
        findings.push({
          checkId: this.checkId,
          level: "warn",
          filePath: "biome.json",
          message: `${settingPath} is ${JSON.stringify(repoSetting)}, plop uses ${JSON.stringify(plopSetting)}`,
          why: SHIBO_PLOP,
        })
      }
    }
    return findings
  },
}

export const repoToolingChecks: Check[] = [
  noForeignLockfiles,
  bunTestRunner,
  biomeFormatter,
]
