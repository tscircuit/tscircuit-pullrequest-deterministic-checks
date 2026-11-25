import type { Check, CheckContext, Finding } from "../types"
import { prDescriptionPngCheck } from "./pr-description-png-check"

/** Repos whose output is a picture; reviewers expect to see it. */
const VISUAL_REPOS = new Set([
  "circuit-to-svg",
  "circuit-to-canvas",
  "pcb-viewer",
  "schematic-viewer",
  "3d-viewer",
  "circuit-json-webgpu",
  "runframe",
])
const DOWNSTREAM_RENDERER_REPOS = new Set([
  "circuit-json-webgpu",
  "pcb-viewer",
  "3d-viewer",
])
const NUMERIC_TOPIC_PATTERN =
  /\b(ibis|spice|waveform|impedance|skew|simulat\w*|timing|rise[- ]time|transmission[- ]line|s-?param\w*)\b/i
/** Only images that actually render in the PR body; a mentioned "foo.snap.svg" filename does not count. */
const IMAGE_PATTERN =
  /!\[[^\]]*\]\([^)]+\)|<img\b|user-attachments\/assets|cleanshot\.com\/share/i
const REFERENCE_TOOL_PATTERN =
  /\b(kicad|hyperlynx|ngspice|xyce|hspice|ltspice|qucs|sigrity|altium|openems|ansys|keysight|\bads\b)/i
const SNAPSHOT_PATTERN = /__snapshots__\/.+\.(png|svg|snap\.svg)$/

function getRepoName(ctx: CheckContext): string {
  return ctx.source.repoFullName?.split("/")[1] ?? ""
}

function isSourceFile(filePath: string): boolean {
  return /^(src|lib)\//.test(filePath) && /\.(ts|tsx)$/.test(filePath)
}

const visualEvidence: Check = {
  checkId: "pr/visual-evidence",
  group: "pr",
  async run(ctx) {
    const pr = ctx.source.pr
    if (!pr) return []
    const findings: Finding[] = []
    const snapshotChanges = ctx.changedFiles.filter((changedFile) =>
      SNAPSHOT_PATTERN.test(changedFile.filePath),
    )
    const touchesRenderingCode =
      VISUAL_REPOS.has(getRepoName(ctx)) &&
      ctx.changedFiles.some((changedFile) => isSourceFile(changedFile.filePath))
    const hasImage = IMAGE_PATTERN.test(pr.body)
    if (touchesRenderingCode && snapshotChanges.length === 0 && !hasImage) {
      findings.push({
        checkId: this.checkId,
        level: "warn",
        message:
          "rendering code changed but no snapshot (__snapshots__/*.png|svg) was added or updated",
        why: 'Shibo: "this PR handles geometry but there is no visualization, hard to understand what\'s going on"',
      })
    }
    if ((snapshotChanges.length > 0 || touchesRenderingCode) && !hasImage) {
      findings.push({
        checkId: this.checkId,
        level: "error",
        message:
          "visual change but the PR body has no image: paste before/after snapshots and link the fixtures in the deployed preview",
        why: 'Shibo: "you need to have the before/after snapshots here too, also put them in the pr body"',
      })
    }
    const modifiedSnapshots = snapshotChanges.filter(
      (changedFile) => changedFile.status !== "added",
    )
    if (
      modifiedSnapshots.length > 0 &&
      !(/\bbefore\b/i.test(pr.body) && /\bafter\b/i.test(pr.body))
    ) {
      findings.push({
        checkId: this.checkId,
        level: "warn",
        message: `${modifiedSnapshots.length} existing snapshot(s) changed but the body has no "before"/"after" comparison`,
        why: 'Seve: "put screenshots of before/after of relevant fixtures"',
      })
    }
    return findings
  },
}

const rendererOrder: Check = {
  checkId: "pr/renderer-order",
  group: "pr",
  async run(ctx) {
    const pr = ctx.source.pr
    if (!pr || !DOWNSTREAM_RENDERER_REPOS.has(getRepoName(ctx))) return []
    if (
      !ctx.changedFiles.some((changedFile) =>
        isSourceFile(changedFile.filePath),
      )
    )
      return []
    if (/circuit-to-(canvas|svg)/.test(pr.body)) return []
    return [
      {
        checkId: this.checkId,
        level: "warn",
        message:
          "new drawing behavior should land in circuit-to-canvas and circuit-to-svg first; link those PRs in the body",
        why: 'Seve: "this feature needs to be in circuit-to-canvas and circuit-to-svg first… we never start w/ webgpu"',
      },
    ]
  },
}

const referenceComparison: Check = {
  checkId: "pr/reference-comparison",
  group: "pr",
  async run(ctx) {
    const pr = ctx.source.pr
    if (!pr) return []
    const changedText = ctx.changedFiles
      .map((changedFile) => changedFile.filePath)
      .join(" ")
    const isNumericWork =
      getRepoName(ctx) === "signal-integrity-pipeline" ||
      NUMERIC_TOPIC_PATTERN.test(`${pr.title} ${changedText}`)
    if (!isNumericWork) return []
    const citesReference =
      REFERENCE_TOOL_PATTERN.test(pr.body) &&
      /compar|side[- ]by[- ]side|\bvs\.?\b|against|matches|reference/i.test(
        pr.body,
      )
    if (citesReference) return []
    return [
      {
        checkId: this.checkId,
        level: "warn",
        message:
          "no side-by-side against a real working tool (KiCad, ngspice, HyperLynx…): add one, and justify any constants",
        why: 'Shibo: "you gotta have a reference from a working tool to compare to"',
      },
    ]
  },
}

const noAiReviewPaste: Check = {
  checkId: "pr/no-ai-review-paste",
  group: "pr",
  async run(ctx) {
    const pr = ctx.source.pr
    if (!pr) return []
    const pastedTexts = [pr.body, ...pr.authorCommentBodies].filter((text) =>
      /\b(codex|claude|ai) review\b|^\s*(\*\*)?\[?P[0-3]\]?(\*\*)?\s/im.test(
        text,
      ),
    )
    return pastedTexts.map((text) => ({
      checkId: this.checkId,
      level: "warn" as const,
      message: `pasted AI review text: "${text.trim().slice(0, 80)}…"; validate it and write it in your own words`,
      why: 'Shibo: "I don\'t want your AI review for your AI"',
    }))
  },
}

const titleClaims: Check = {
  checkId: "pr/title-claims",
  group: "pr",
  async run(ctx) {
    const pr = ctx.source.pr
    if (!pr || !/\b(end[- ]to[- ]end|e2e)\b/i.test(`${pr.title}\n${pr.body}`))
      return []
    return [
      {
        checkId: this.checkId,
        level: "warn",
        message:
          'PR claims "end to end": make sure a test goes TSX → final output with no stubs or fixtures in between',
        why: 'Shibo: "this is not end to end like the title says"',
      },
    ]
  },
}

export const prBodyChecks: Check[] = [
  visualEvidence,
  prDescriptionPngCheck,
  rendererOrder,
  referenceComparison,
  noAiReviewPaste,
  titleClaims,
]
