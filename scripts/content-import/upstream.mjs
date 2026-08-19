// content-import/upstream.mjs — which upstream checkout to import, and the two pure transforms applied to every file.
// Chapter of scripts/import-content.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-50). Caught by the repo-wide file-size gate
// W10-49 turned on one ticket earlier, on the very next ticket.

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/** Upstream repo, renamed from `bpm-opencode-experts` in v3.0.0. */
export const UPSTREAM_REPO_NAME = 'attest'
/** Kept so the 89 provenance headers already carrying it stay explicable. */
export const UPSTREAM_REPO_ALIAS = 'bpm-opencode-experts'

const DEFAULT_SOURCE_ROOT = join(homedir(), 'Code', UPSTREAM_REPO_NAME)

/**
 * Resolve and VALIDATE the upstream checkout.
 *
 * Exits non-zero with a named error rather than letting `readdirSync` throw an
 * ENOENT stack: the whole point is that a wrong source root is the difference
 * between a real import and a broken one, and the operator needs to be told
 * which path was tried and that the repo was renamed.
 */
export function resolveSourceRoot(argv = process.argv, env = process.env) {
  const flag = argv.find((a) => a.startsWith('--source='))
  const root =
    (flag ? flag.slice('--source='.length) : undefined) ??
    env.DOKIMA_CONTENT_SOURCE ??
    DEFAULT_SOURCE_ROOT

  if (!existsSync(root)) {
    throw new Error(
      `content import: upstream checkout not found at ${root}.\n` +
        `The upstream repo was renamed ${UPSTREAM_REPO_ALIAS} -> ${UPSTREAM_REPO_NAME} in v3.0.0; ` +
        `a stale path is the usual cause.\n` +
        `Point at it with --source=<path> or DOKIMA_CONTENT_SOURCE=<path>.`,
    )
  }
  if (!existsSync(join(root, 'agents'))) {
    throw new Error(
      `content import: ${root} exists but has no agents/ directory — that is not an upstream checkout.`,
    )
  }
  return root
}

/** The upstream version actually imported, recorded in the manifest. */
export function readUpstreamVersion(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Files Dokima has deliberately patched locally. A re-import that silently
 * overwrote one of these would be a supply-chain event, not a merge conflict:
 * validators are shell scripts the product executes, and the pack is signed.
 * Keyed by the imported path relative to content/.
 */
export const LOCAL_OVERRIDES = {
  'validators/validate-mermaid.sh':
    'W9-08 patched this locally; upstream version renders differently. Re-apply or re-verify before accepting an upstream copy.',
}

/**
 * The marker a Dokima-native file carries in its own header (W13-17).
 *
 * Native files are NOT `LOCAL_OVERRIDES`. That registry is for upstream files
 * Dokima has patched — the question there is "which copy wins". These are
 * files upstream never had and never will, where the question does not arise.
 *
 * DETECTED FROM THE FILE, NOT A HAND-KEPT LIST: `pm-interviewer.md` has said
 * "Provenance: Dokima-native" in its header since it was written for W5-02,
 * and a second list would drift from that the first time someone adds one.
 */
export const NATIVE_MARKER = 'Dokima-native'

/** True when a file declares itself Dokima-native in its own header. */
export function isNativeContent(text) {
  return text.includes(NATIVE_MARKER)
}

/**
 * Rewrite host-install paths to Dokima's content-relative form.
 *
 * 72 already-imported files hardcode `~/.config/opencode/…`, a path that does
 * not exist under Dokima, and upstream has grown that to 95 — so importing
 * without this makes an existing portability bug ~30% worse. The importer did
 * no path rewriting at all before W10-50: its only `.replace` calls stripped
 * comments and file extensions.
 */
export function rewriteHostPaths(content) {
  return content
    .replace(/~\/\.config\/opencode\/agents\/shared\//g, 'content/protocols/')
    .replace(/~\/\.config\/opencode\/scripts\/validators\//g, 'content/validators/')
    .replace(/~\/\.config\/opencode\/agents\//g, 'content/experts/')
    .replace(/~\/\.config\/opencode\//g, 'content/')
}
