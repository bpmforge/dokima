#!/usr/bin/env node

/**
 * Content import from the upstream expert-system repo.
 *
 * Copies the expert system (agents), the validator pack (bash scripts + shared
 * libs), and the shared protocol docs into content/, each with a provenance
 * header. No build-time dependency on the source repo remains after this runs
 * (C8): content/ is plain data, and content/index.json is regenerated purely
 * from the on-disk content tree.
 *
 * W10-50, four fixes. The source root was hardcoded to
 * `/Users/bmatthews/Code/bpm-opencode-experts`, which stopped existing when
 * upstream renamed to `attest` in v3.0.0 — so this script threw a raw ENOENT
 * from `readdirSync` naming a repo nobody would recognise, with no hint that
 * the fix was a rename. (docs/work/W10_PLAN.md §2 describes that failure as "a
 * silent empty import"; it is not — `--manifest-only` is the path that works
 * silently, because it skips the copy entirely.) Now: a configurable, pinned
 * source root with a named error; host-install paths rewritten at import time;
 * a local-override registry so a deliberate local patch cannot be clobbered
 * silently; and `--dry-run`, which writes nothing.
 *
 * Usage:
 *   node scripts/import-content.mjs                 full import + manifest
 *   node scripts/import-content.mjs --dry-run       report added/removed/drifted, write nothing
 *   node scripts/import-content.mjs --manifest-only regenerate content/index.json
 *                                                   from the already-imported tree
 *                                                   (no source repo access)
 *   --source=<path>   override the upstream checkout (default ~/Code/attest)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import {
  UPSTREAM_REPO_NAME,
  UPSTREAM_REPO_ALIAS,
  LOCAL_OVERRIDES,
  resolveSourceRoot,
  readUpstreamVersion,
  rewriteHostPaths,
} from './content-import/upstream.mjs'
import { dryRunReport } from './content-import/dry-run.mjs'

// Re-exported so scripts/import-content.test.mjs and any caller keep importing
// from this path — the same barrel discipline W10-46/47/48 used.
export {
  UPSTREAM_REPO_NAME,
  UPSTREAM_REPO_ALIAS,
  LOCAL_OVERRIDES,
  resolveSourceRoot,
  readUpstreamVersion,
  rewriteHostPaths,
}

const __dirname = join(fileURLToPath(import.meta.url), '..')
const repoRoot = join(__dirname, '..')
const contentRoot = join(repoRoot, 'content')
const manifestOnly = process.argv.includes('--manifest-only')
const dryRun = process.argv.includes('--dry-run')


// Expert clusters, in manifest display order, with their human-readable role.
// `onboard` mirrors the source repo's agents/sdlc/onboard/ grouping; the rest
// of agents/sdlc/ (orchestration protocols and leads) maps to `coordinators`.
const CLUSTER_ROLES = {
  coordinators: 'Program orchestrators and decision engines',
  onboard:
    'Onboard specialists — reverse-engineer an existing codebase into SDLC artifacts (source: agents/sdlc/onboard/)',
  'phase-specialists': 'Domain specialists for SDLC phases',
  'code-review': 'Code health and quality cluster',
  security: 'Security analysis specialists',
  performance: 'Performance and optimization cluster',
  game: 'Game development specialists',
  other: 'Cross-cutting and specialized agents',
}

const expertClusters = Object.keys(CLUSTER_ROLES)

const contentDirs = [
  ...expertClusters.map(c => join(contentRoot, 'experts', c)),
  join(contentRoot, 'validators'),
  join(contentRoot, 'protocols'),
]

/** Resolve the import date: reuse the date stamped into already-imported
 *  content when present (keeps re-runs deterministic and consistent with the
 *  provenance headers), otherwise stamp today. */
function resolveImportDate() {
  const probe = join(contentRoot, 'protocols', 'MICRO_LOOP.md')
  if (existsSync(probe)) {
    const m = readFileSync(probe, 'utf8').match(/Import date:\s*(\d{4}-\d{2}-\d{2})/)
    if (m) return m[1]
  }
  return new Date().toISOString().split('T')[0]
}

const importDate = resolveImportDate()

/** Assigned in main() only when a copy is actually going to happen, so
 *  `--manifest-only` keeps working with no upstream checkout present. */
let sourceRoot
let upstreamVersion = 'unknown'


/** Insert an HTML-comment provenance header (after frontmatter when present). */
function addMdProvenance(content, sourcePath) {
  const header = `<!--
  Provenance: ${UPSTREAM_REPO_NAME} (formerly ${UPSTREAM_REPO_ALIAS})
  Upstream version: ${upstreamVersion}
  Source path: ${sourcePath}
  Import date: ${importDate}
  DO NOT EDIT — this is imported content
-->

`
  content = rewriteHostPaths(content)
  if (content.startsWith('---')) {
    const endFrontmatter = content.indexOf('\n---\n')
    if (endFrontmatter > 0) {
      return (
        content.substring(0, endFrontmatter + 5) +
        '\n' +
        header +
        content.substring(endFrontmatter + 5)
      )
    }
  }
  return header + content
}

/** Prepend a bash-comment provenance header, replacing the original shebang. */
function addShProvenance(content, sourcePath) {
  const header = `#!/bin/bash
# Provenance: ${UPSTREAM_REPO_NAME} (formerly ${UPSTREAM_REPO_ALIAS})
# Upstream version: ${upstreamVersion}
# Source path: ${sourcePath}
# Import date: ${importDate}
# DO NOT EDIT — this is imported content

`
  const rewritten = rewriteHostPaths(content)
  const body = rewritten.startsWith('#!/') ? rewritten.split('\n').slice(1).join('\n') : rewritten
  return header + body
}

/** Copy agents from source, organized by cluster. */
function copyAgents() {
  const agentsSource = join(sourceRoot, 'agents')

  // Cluster subdirectories: source dir -> target expert cluster.
  // agents/sdlc splits: onboard/ -> onboard, everything else -> coordinators.
  const clusterMap = {
    'code-review': 'code-review',
    security: 'security',
    performance: 'performance',
    game: 'game',
  }

  let agentCount = 0

  // Top-level agents, classified by name pattern.
  for (const file of readdirSync(agentsSource).filter(
    f => statSync(join(agentsSource, f)).isFile() && f.endsWith('.md')
  )) {
    const content = addMdProvenance(readFileSync(join(agentsSource, file), 'utf8'), `agents/${file}`)
    let category = 'other'
    if (file.includes('guide') || file.includes('sdlc-lead') || file.includes('task-decomposer')) {
      category = 'coordinators'
    } else if (
      file.includes('specialist') ||
      file.includes('-designer') ||
      file.includes('-engineer') ||
      file.includes('researcher')
    ) {
      category = 'phase-specialists'
    }
    writeFileSync(join(contentRoot, 'experts', category, file), content, 'utf8')
    agentCount++
  }

  function walkCluster(dirPath, relPath, targetFor) {
    for (const item of readdirSync(dirPath)) {
      const fullPath = join(dirPath, item)
      if (statSync(fullPath).isDirectory()) {
        walkCluster(fullPath, `${relPath}/${item}`, targetFor)
      } else if (item.endsWith('.md')) {
        const sourcePath = `agents/${relPath}/${item}`
        const target = targetFor(`${relPath}/${item}`)
        const content = addMdProvenance(readFileSync(fullPath, 'utf8'), sourcePath)
        writeFileSync(join(contentRoot, 'experts', target, item), content, 'utf8')
        agentCount++
      }
    }
  }

  // sdlc: onboard/ subdir -> onboard cluster; all else -> coordinators.
  const sdlcPath = join(agentsSource, 'sdlc')
  if (statSync(sdlcPath, { throwIfNoEntry: false })?.isDirectory()) {
    walkCluster(sdlcPath, 'sdlc', rel => (rel.includes('/onboard/') ? 'onboard' : 'coordinators'))
  }

  for (const [clusterDir, category] of Object.entries(clusterMap)) {
    const clusterPath = join(agentsSource, clusterDir)
    if (!statSync(clusterPath, { throwIfNoEntry: false })?.isDirectory()) continue
    walkCluster(clusterPath, clusterDir, () => category)
  }

  // Shared protocol docs.
  const sharedPath = join(agentsSource, 'shared')
  const protocolNames = [
    'HANDOFF_TEMPLATES.md',
    'HANDOFF_QUICK_REF.md',
    'MICRO_LOOP.md',
    'GATE_SCORING_PROTOCOL.md',
    'AUTONOMY_PROTOCOL.md',
    'CHALLENGER_PROTOCOL.md',
    'RALPH_WIGGUM_LOOP.md',
    'FIX_VERIFY_LOOP.md',
  ]
  for (const file of protocolNames) {
    const fullPath = join(sharedPath, file)
    if (!statSync(fullPath, { throwIfNoEntry: false })?.isFile()) continue
    const content = addMdProvenance(readFileSync(fullPath, 'utf8'), `agents/shared/${file}`)
    writeFileSync(join(contentRoot, 'protocols', file), content, 'utf8')
  }

  return agentCount
}

/** Copy the validator pack: validate-*.sh, the run-*.sh drivers, and the
 *  shared _lib*.sh they source (without which the pack cannot run). */
function copyValidators() {
  const validatorsSource = join(sourceRoot, 'scripts/validators')
  const files = readdirSync(validatorsSource).filter(
    f =>
      f.endsWith('.sh') &&
      (f.startsWith('validate-') || f.startsWith('run-') || f.startsWith('_lib'))
  )
  for (const file of files) {
    const content = addShProvenance(
      readFileSync(join(validatorsSource, file), 'utf8'),
      `scripts/validators/${file}`
    )
    writeFileSync(join(contentRoot, 'validators', file), content, 'utf8')
  }
  return files.length
}

/** First frontmatter `name:`/`description:` line for an agent/protocol doc,
 *  or the first non-comment content line for a validator script. Truncated. */
function describe(file, content) {
  if (file.endsWith('.md')) {
    const stripped = content.replace(/<!--[\s\S]*?-->\n\n/, '')
    if (stripped.startsWith('---')) {
      const end = stripped.indexOf('\n---', 3)
      const fm = stripped.slice(3, end < 0 ? undefined : end)
      const line = fm.split('\n').find(l => /^\s*(name|description):/.test(l))
      if (line) return line.trim().slice(0, 100)
    }
    const first = stripped.split('\n').find(l => l.trim())
    return (first || '').trim().slice(0, 100)
  }
  // shell script: first non-blank, non-comment line
  const line = content.split('\n').find(l => l.trim() && !l.trim().startsWith('#'))
  return (line || '').trim().slice(0, 100)
}

/** Enumerate a directory of files into { key: { file, description } }. */
function enumerateDir(dir) {
  const items = {}
  for (const file of readdirSync(dir).sort()) {
    const full = join(dir, file)
    if (!statSync(full).isFile()) continue
    const key = file.replace(/\.(md|sh)$/, '')
    items[key] = { file, description: describe(file, readFileSync(full, 'utf8')) }
  }
  return items
}

/** Regenerate content/index.json purely from the on-disk content tree. */
function generateManifest() {
  const experts = {}
  let expertCount = 0
  for (const cluster of expertClusters) {
    const dir = join(contentRoot, 'experts', cluster)
    if (!existsSync(dir)) continue
    const items = enumerateDir(dir)
    experts[cluster] = { role: CLUSTER_ROLES[cluster], count: Object.keys(items).length, items }
    expertCount += Object.keys(items).length
  }

  const validatorItems = enumerateDir(join(contentRoot, 'validators'))
  const protocolItems = enumerateDir(join(contentRoot, 'protocols'))

  const manifest = {
    version: 1,
    importDate,
    sourceRepo: UPSTREAM_REPO_NAME,
    sourceRepoAlias: UPSTREAM_REPO_ALIAS,
    upstreamVersion,
    summary: {
      experts: expertCount,
      validators: Object.keys(validatorItems).length,
      protocols: Object.keys(protocolItems).length,
    },
    experts,
    validators: {
      overview:
        'Executable validators (bash scripts) implementing the 0/1 + JSON-gaps contract, plus the shared _lib*.sh they source',
      count: Object.keys(validatorItems).length,
      items: validatorItems,
    },
    protocols: {
      overview: 'Shared protocol specifications and agent coordination patterns',
      count: Object.keys(protocolItems).length,
      items: protocolItems,
    },
  }

  writeFileSync(join(contentRoot, 'index.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest
}

function main() {
  if (manifestOnly) {
    console.log('📋 Generating manifest from on-disk content...')
    const manifest = generateManifest()
    console.log(
      `✅ Manifest: ${manifest.summary.experts} experts, ` +
        `${manifest.summary.validators} validators, ${manifest.summary.protocols} protocols`
    )
    return
  }

  // Resolved here, not at module scope: --manifest-only must keep working with
  // no upstream checkout present, and a wrong path must be a named error.
  sourceRoot = resolveSourceRoot()
  upstreamVersion = readUpstreamVersion(sourceRoot)

  if (dryRun) {
    dryRunReport({ sourceRoot, contentRoot, expertClusters, upstreamVersion })
    return
  }

  const blocked = Object.keys(LOCAL_OVERRIDES).filter((rel) => existsSync(join(contentRoot, rel)))
  if (blocked.length) {
    console.error(
      'content import refused — these files are registered local overrides and would be clobbered:\n' +
        blocked.map((rel) => `  - ${rel}: ${LOCAL_OVERRIDES[rel]}`).join('\n') +
        '\n\nRe-apply them after import, or remove the registry entry once upstream has absorbed the patch.',
    )
    process.exitCode = 1
    return
  }

  contentDirs.forEach(dir => mkdirSync(dir, { recursive: true }))
  console.log(`📚 Copying agents from ${sourceRoot} @ v${upstreamVersion}...`)
  copyAgents()
  console.log('🔍 Copying validators...')
  copyValidators()

  console.log('📋 Generating manifest from on-disk content...')
  const manifest = generateManifest()

  console.log(
    `✅ Manifest: ${manifest.summary.experts} experts, ` +
      `${manifest.summary.validators} validators, ${manifest.summary.protocols} protocols`
  )
}

// Only run when executed directly, so the helpers above are importable by tests.
if (process.argv[1] && process.argv[1].endsWith('import-content.mjs')) {
  try {
    main()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
