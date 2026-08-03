// content-import/dry-run.mjs — the added / removed / drifted report. Writes nothing.
// Chapter of scripts/import-content.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-50). Caught by the repo-wide file-size gate
// W10-49 turned on one ticket earlier, on the very next ticket.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { LOCAL_OVERRIDES, rewriteHostPaths } from './upstream.mjs'


/** Body-compare two files ignoring the provenance header the importer adds. */
function bodyOf(text) {
  return text
    // The md header is inserted AFTER frontmatter and is followed by a blank
    // line the writer adds plus one already in the body — match greedily on
    // trailing whitespace rather than a fixed count.
    .replace(/<!--\s*\n\s*Provenance:[\s\S]*?-->\s*\n/, '')
    .replace(/^#!\/bin\/bash\n(?:#[^\n]*\n)+?\n/, '')
    .replace(/^#!\S*\n/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Report what a real import WOULD change, writing nothing.
 *
 * Compares upstream bodies against what is already in content/, with the
 * provenance header stripped from both sides — the importer rewrites shebangs,
 * and a naive diff therefore reported 78-of-78 validators "changed" when only 8
 * really were (docs/work/W10_PLAN.md §0 records that artifact). Host paths are
 * rewritten before comparing, so the portability fix does not masquerade as
 * upstream drift.
 */
export function dryRunReport({ sourceRoot, contentRoot, expertClusters, upstreamVersion }) {
  const upstreamAgents = new Map()
  // Agents only. `shared/` becomes content/protocols/ and `templates/` becomes
  // references — counting them as experts is what made the first run of this
  // report claim 61 additions against §0's measured 6.
  const NON_AGENT_DIRS = new Set(['shared', 'templates'])
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (!NON_AGENT_DIRS.has(entry)) walk(full)
      } else if (entry.endsWith('.md')) upstreamAgents.set(entry, full)
    }
  }
  walk(join(sourceRoot, 'agents'))

  const localAgents = new Map()
  const expertsRoot = join(contentRoot, 'experts')
  // Top-level too: pm-interviewer.md sits there as an orphan, and it is exactly
  // the one file §0 measured as gone upstream.
  for (const dir of [expertsRoot, ...expertClusters.map((c) => join(expertsRoot, c))]) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      localAgents.set(f, join(dir, f))
    }
  }

  const added = [...upstreamAgents.keys()].filter((k) => !localAgents.has(k))
  const removed = [...localAgents.keys()].filter((k) => !upstreamAgents.has(k))
  let drifted = 0
  let identical = 0
  // Counted BOTH ways on purpose. docs/work/W10_PLAN.md §0 measured drift
  // without the host-path rewrite (it did not exist yet) and got 17 identical;
  // this report reproduces that number exactly. With the rewrite applied, 11 of
  // those 17 become "drifted" — they change on import solely because of the
  // portability fix, not because upstream edited them. Reporting only one
  // number would either contradict §0 or hide the rewrite's real blast radius.
  let identicalBeforeRewrite = 0
  for (const [name, localPath] of localAgents) {
    const up = upstreamAgents.get(name)
    if (!up) continue
    const raw = readFileSync(up, 'utf8')
    const b = bodyOf(readFileSync(localPath, 'utf8'))
    if (bodyOf(raw) === b) identicalBeforeRewrite++
    if (bodyOf(rewriteHostPaths(raw)) === b) identical++
    else drifted++
  }

  const hostPathFiles = [...upstreamAgents.values()].filter((f) =>
    readFileSync(f, 'utf8').includes('~/.config/opencode/'),
  ).length

  const overrides = Object.keys(LOCAL_OVERRIDES).filter((rel) =>
    existsSync(join(contentRoot, rel)),
  )

  console.log(`\nDRY RUN — nothing written. upstream ${sourceRoot} @ v${upstreamVersion}\n`)
  console.log(`  experts drifted   ${drifted}  (${drifted - (identicalBeforeRewrite - identical)} upstream edits + ${identicalBeforeRewrite - identical} from the host-path rewrite)`)
  console.log(`  experts identical ${identical}  (${identicalBeforeRewrite} before the host-path rewrite — the number W10_PLAN §0 measured)`)
  console.log(`  experts added     ${added.length}${added.length ? '  ' + added.join(', ') : ''}`)
  console.log(`  experts removed   ${removed.length}${removed.length ? '  ' + removed.join(', ') : ''}`)
  console.log(`  upstream files carrying a ~/.config/opencode path: ${hostPathFiles} (rewritten on import)`)
  console.log(`  local overrides that would be overwritten: ${overrides.length ? overrides.join(', ') : 'none'}`)
  if (overrides.length) {
    console.log('\n  Each is registered in LOCAL_OVERRIDES and must be re-applied or re-verified;')
    console.log('  a real import refuses rather than clobbering them silently.')
  }
}

