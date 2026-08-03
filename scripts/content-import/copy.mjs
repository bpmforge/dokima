// content-import/copy.mjs — the file-copy half of the import: agents into
// their clusters, validators into the pack. Chapter of scripts/import-content.mjs
// under the 400-line CODE_BOOK_PROTOCOL cap (W10-51), which the repo-wide
// file-size gate flagged the moment --reapply-overrides pushed it to 413.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'

/** Copy agents from source, organized by cluster. */
export function copyAgents({ sourceRoot, contentRoot, addMdProvenance }) {
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
  // W10-51: this was a hardcoded list of EIGHT filenames while
  // content/protocols/ held twenty-six — so eighteen protocol docs were never
  // refreshed by any import and had been drifting silently since the W1-01
  // one-time import. It is why two files still carried ~/.config/opencode/
  // host paths after the rewrite landed: they were never re-copied at all.
  // Enumerated from disk now, so a protocol added upstream arrives on the next
  // import instead of requiring someone to remember to extend an array.
  const protocolNames = existsSync(sharedPath)
    ? readdirSync(sharedPath)
        .filter((f) => f.endsWith('.md'))
        .sort()
    : []

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
export function copyValidators({ sourceRoot, contentRoot, addShProvenance }) {
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
