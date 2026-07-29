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

# A Go project's gate tools (golangci-lint et al) install to $(go env GOPATH)/bin,
# which an interactive shell gets from the user's profile but a nohup'd daemon does
# NOT. Without this, `make lint` dies with "golangci-lint: No such file or directory"
# and the conductor reads it as a ticket gate failure, burning a retry per ticket
# rather than reporting a broken environment once. Observed in Kryptkeeper
# 2026-07-29: S-27 failed this way on attempt 1 and retried on a defect that was
# never in the ticket. Inert here (Shipwright has no go.mod) but this file is the
# canonical copy that ported projects vendor.
if [ -f go.mod ] && command -v go >/dev/null 2>&1; then
  GOBIN_DIR="$(go env GOPATH 2>/dev/null)/bin"
  if [ -d "$GOBIN_DIR" ]; then
    case ":$PATH:" in *":$GOBIN_DIR:"*) : ;; *) export PATH="$GOBIN_DIR:$PATH";; esac
  fi
  # Fail fast and loudly rather than letting every Go ticket discover it one at a time.
  if grep -qE '^[[:space:]]*"make",?$|"lint"' conductor.config.json 2>/dev/null; then
    command -v golangci-lint >/dev/null 2>&1 || {
      echo "[supervise] FATAL: conductor.config.json gates on 'make lint' but golangci-lint is not on PATH"
      echo "[supervise]        looked in ${GOBIN_DIR} — install it, or drop the lint gate from the config"
      exit 1
    }
  fi
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
  # NEVER delete a branch that carries commits main does not have.
  #
  # This cleanup exists to clear a crashed attempt's debris, but under
  # --no-merge the conductor's FINISHED work is parked on exactly these
  # prefixed branches and is deliberately never merged. Deleting by prefix
  # alone therefore destroys every completed ticket on the first crash-restart.
  # Observed 2026-07-28: launching supervise.sh silently deleted a parked,
  # review-APPROVED branch. `git branch -d` (not -D) refuses unmerged branches,
  # so the safe behaviour is also the simpler one — an unmerged branch is
  # reported and kept for the human instead.
  git for-each-ref --format='%(refname:short)' refs/heads/ \
    | grep -E "^(${BRANCH_PREFIX}|feat/w[0-9].*-auto$)" \
    | while read -r b; do
        wt_path="$(git worktree list --porcelain | grep -A2 "branch refs/heads/$b" | grep '^worktree ' | cut -d' ' -f2)"
        [ -n "$wt_path" ] && git worktree remove --force "$wt_path" >/dev/null 2>&1
        if [ "$(git rev-list --count "main..$b" 2>/dev/null || echo 0)" -gt 0 ]; then
          log "keeping $b — has commits not on main (parked work, or a crash mid-ticket)"
        else
          git branch -d "$b" >/dev/null 2>&1
        fi
      done
  # Only remove worktree checkouts, never the branches they pointed at.
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
