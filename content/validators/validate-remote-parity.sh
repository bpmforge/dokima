#!/bin/bash
#
# validate-remote-parity.sh -- close-gate dual-remote parity check
# (BLUEPRINT: "Dual-remote sync supported natively ... with a
# remote-parity check as a validator", FR-I2, amplifier hole 11,
# docs/research/source-system-amplifier.md). Flags a remote that has
# fallen behind local HEAD -- proof that `pushToRemotes`
# (packages/forge/src/dual-remote.ts), the only mechanism that lands
# commits on a configured remote, actually ran before a ticket close can
# claim done.
#
# LOCAL-FIRST (Law 9/C-1): this validator never touches the network -- it
# only reads remote-tracking refs already cached in the local .git dir
# (refs/remotes/<remote>/<branch>). A remote with NO cached tracking ref
# for the current branch (offline, a fresh branch never pushed, or a
# remote nobody has fetched/pushed for this branch yet) is the normal
# offline case and is NEVER a gap -- there is nothing to compare against.
# A gap is raised ONLY when a tracking ref already exists locally and its
# sha disagrees with the local branch tip: real, detectable divergence,
# not the mere absence of one.
#
# Usage: validate-remote-parity.sh [project-root]
# Exit 0 clean / 1 gaps / 2 error.

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

validator_init "validate-remote-parity"

ROOT="$(detect_project_root "${1:-}")"

if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  note "not a git repository at $ROOT -- nothing to check"
  validator_exit
fi

BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [[ -z "$BRANCH" || "$BRANCH" == "HEAD" ]]; then
  note "detached HEAD or no branch resolvable at $ROOT -- nothing to check"
  validator_exit
fi

LOCAL_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ -z "$LOCAL_SHA" ]]; then
  note "no commits on HEAD yet -- nothing to check"
  validator_exit
fi

REMOTES="$(git -C "$ROOT" remote 2>/dev/null || true)"
if [[ -z "$REMOTES" ]]; then
  note "no remotes configured -- nothing to check (local-first, Law 9/C-1)"
  validator_exit
fi

while IFS= read -r remote; do
  [[ -z "$remote" ]] && continue
  tracking_ref="refs/remotes/${remote}/${BRANCH}"
  tracking_sha="$(git -C "$ROOT" rev-parse --verify -q "$tracking_ref" 2>/dev/null || true)"

  if [[ -z "$tracking_sha" ]]; then
    note "remote \"$remote\" has no cached tracking ref for $BRANCH (offline / never pushed) -- pass"
    continue
  fi

  if [[ "$tracking_sha" != "$LOCAL_SHA" ]]; then
    gap "remote-divergence" \
      "remote \"$remote\" tracking ref $tracking_ref is at ${tracking_sha:0:12} but local $BRANCH is at ${LOCAL_SHA:0:12} -- push not landed or diverged"
  else
    pass "remote \"$remote\" tracking ref matches local $BRANCH (${LOCAL_SHA:0:12})"
  fi
done <<< "$REMOTES"

if [[ "$GAP_COUNT" -eq 0 ]]; then
  pass "no remote-tracking divergence detected for $BRANCH"
fi

validator_exit
