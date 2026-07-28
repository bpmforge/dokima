#!/usr/bin/env bash
# supervise.sh — keeps the conductor alive across its OWN process death.
#
# Two independent recovery layers:
#   • provider session/usage limits  -> handled INSIDE conductor.mjs (sleep to reset)
#   • conductor process crash/fatal  -> handled HERE (reset tree, relaunch)
#
# Usage: nohup caffeinate -dimsu bash scripts/supervise.sh --waves W0,W1,W2 --escalate \
#          >> docs/work/conductor.out 2>&1 &
# Stop:  touch STOP   (checked before every (re)launch and after every crash)
set -u
cd "$(dirname "$0")/.."

# W3-15: resolve Node from the project's version pin — never a hardcoded version.
# A mismatched Node ABI-breaks native modules (better-sqlite3 here).
#
# The pin's LOCATION is project-specific: conductor.config.json's `nvmrcPath`,
# defaulting to .nvmrc. Shipwright pins at the root; a ported repo may pin
# elsewhere (Kryptkeeper: ui/.nvmrc) or not at all. No pin => use whatever Node
# is already on PATH, rather than refusing to start. Mirrors the same check in
# conductor.mjs; keep the two in step.
PIN_PATH='.nvmrc'
if [ -f conductor.config.json ]; then
  CFG_PIN="$(sed -n 's/.*"nvmrcPath"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' conductor.config.json | head -1)"
  # An explicit `"nvmrcPath": null` means "this project pins nowhere".
  if grep -Eq '"nvmrcPath"[[:space:]]*:[[:space:]]*null' conductor.config.json; then PIN_PATH=''
  elif [ -n "$CFG_PIN" ]; then PIN_PATH="$CFG_PIN"; fi
fi

if [ -n "$PIN_PATH" ] && [ -f "$PIN_PATH" ]; then
  NVMRC_MAJOR="$(tr -d '[:space:]' < "$PIN_PATH")"
  NODE_BIN="$(ls -d "$HOME/.local/share/fnm/node-versions/v${NVMRC_MAJOR}"*/installation/bin 2>/dev/null | sort -V | tail -1)"
  if [ -z "$NODE_BIN" ]; then echo "[supervise] FATAL: no fnm Node v${NVMRC_MAJOR}.x installed (fnm install ${NVMRC_MAJOR})"; exit 1; fi
  export PATH="$NODE_BIN:$PATH"
  ACTUAL="$(node -v)"
  case "$ACTUAL" in v${NVMRC_MAJOR}.*) : ;; *) echo "[supervise] FATAL: node $ACTUAL != ${PIN_PATH} v${NVMRC_MAJOR}.x"; exit 1;; esac
else
  command -v node >/dev/null 2>&1 || { echo "[supervise] FATAL: no node on PATH and no version pin to resolve one"; exit 1; }
  echo "[supervise] no Node pin (${PIN_PATH:-nvmrcPath=null}) — using $(node -v) from PATH"
fi

# Crash-cleanup targets are project-specific too: which branches this conductor
# owns, and where it puts worktrees. Defaults match Shipwright.
BRANCH_PREFIX='sw/'
WORKTREE_DIR='../.shipwright-worktrees'
if [ -f conductor.config.json ]; then
  CFG_BP="$(sed -n 's/.*"branchPrefix"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' conductor.config.json | head -1)"
  CFG_WD="$(sed -n 's/.*"worktreeDir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' conductor.config.json | head -1)"
  [ -n "$CFG_BP" ] && BRANCH_PREFIX="$CFG_BP"
  [ -n "$CFG_WD" ] && WORKTREE_DIR="$CFG_WD"
fi

MAX=${SUPERVISE_MAX:-30}     # give up after this many crash-restarts
BACKOFF=${SUPERVISE_BACKOFF:-30}
n=0
log(){ echo "[supervise $(date -u +%FT%TZ)] $*"; }

while :; do
  if [ -f STOP ]; then log "STOP present — exiting"; break; fi

  # A crashed conductor leaves the tree on a feature branch with uncommitted work,
  # which fails the conductor's clean-tree preflight. Reset to committed main so it
  # can re-claim from board state. Only abandons the crashed attempt (redone idempotently).
  # (With worktree isolation, ROOT stays on main even across a crash — this is mostly
  #  belt-and-suspenders — but a crashed run can leave dangling worktrees + sw/ branches.)
  git checkout -f main >/dev/null 2>&1
  git clean -fd >/dev/null 2>&1
  git worktree prune >/dev/null 2>&1
  git for-each-ref --format='%(refname:short)' refs/heads/ \
    | grep -E "^(${BRANCH_PREFIX}|feat/w[0-9].*-auto$)" \
    | while read -r b; do git worktree remove --force "$(git worktree list --porcelain | grep -A2 "branch refs/heads/$b" | grep '^worktree ' | cut -d' ' -f2)" >/dev/null 2>&1; git branch -D "$b" >/dev/null 2>&1; done
  rm -rf "$WORKTREE_DIR" >/dev/null 2>&1

  log "starting conductor (launch $((n+1)))"
  node scripts/conductor.mjs "$@"
  code=$?
  log "conductor exited code=$code"

  [ "$code" -eq 0 ] && { log "clean exit — board drained or breakpoint; done"; break; }
  [ -f STOP ] && { log "STOP present after crash — exiting"; break; }
  n=$((n+1))
  [ "$n" -ge "$MAX" ] && { log "hit MAX=$MAX restarts — giving up, needs a human"; break; }
  log "crash; restarting in ${BACKOFF}s (restart $n/$MAX)"
  sleep "$BACKOFF"
done
log "supervisor stopped"
