#!/usr/bin/env bash
# autorun.sh — one-command front door for an unattended conductor run.
#
# Everything here was already possible by hand; CONDUCTOR_RUNBOOK.md spelled out
# the four lines. The trouble with four hand-typed lines is that three of them
# fail SILENTLY when forgotten: no `caffeinate` and the machine sleeps mid-run,
# no redirect and an overnight run leaves no log, no pid file and `stop` becomes
# `pkill` guesswork against a process tree that includes the agent sessions you
# very much do not want to kill that way.
#
#   scripts/autorun.sh start [supervise args...]   launch (backgrounded, survives logout)
#   scripts/autorun.sh stop                        graceful: STOP sentinel, then the supervisor
#   scripts/autorun.sh status                      liveness, recent log, board tally
#
# Extra args pass through to supervise.sh untouched, so the runbook's
# `--waves W9 --breakpoint never --no-merge` all still work.
#
# NOT escalated by default, deliberately. conductor.config.json's $modelsNote:
# "Overnight runs launch WITHOUT --escalate: sonnet-only ladder, frontier spend
# requires a human (escalation-token principle by configuration, D-018)." A
# convenience that quietly raises your spend ceiling is not a convenience.
set -u
cd "$(dirname "$0")/.."

OUT='docs/work/conductor.out'
PIDFILE='docs/work/supervise.pid'
STOPFILE='STOP'

# Alive means: the pid file exists AND names a running process. A stale pid file
# (machine rebooted mid-run, supervisor SIGKILLed) must never permanently block a
# relaunch — that turns a crash into an outage waiting for someone to notice a file.
supervisor_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)" || return 1
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

# supervise.sh resets to main and runs `git clean -fd` before each launch. That is
# right for crash debris and destructive for a human who launched from a feature
# branch mid-edit. supervise.sh refuses this itself, but check here too so the
# refusal arrives BEFORE anything is backgrounded — a failure that only shows up
# in a log file you have to go read is a worse failure.
assert_clean_tree() {
  local branch dirty
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  dirty="$(git status --porcelain 2>/dev/null)"
  if [ -n "$dirty" ] || [ "$branch" != 'main' ]; then
    echo "autorun: refusing to start — the working tree is dirty or not on main."
    echo "         branch: $branch"
    echo
    echo "         The supervisor resets to main and runs 'git clean -fd' before every"
    echo "         launch. Starting now would DESTROY uncommitted changes and delete"
    echo "         untracked files. Commit or stash first."
    [ -n "$dirty" ] && { echo; echo "$dirty" | sed 's/^/         /' | head -20; }
    return 1
  fi
}

cmd_start() {
  local pid
  if pid="$(supervisor_pid)"; then
    echo "autorun: already running (supervisor pid $pid)."
    echo "         tail -f $OUT              # watch"
    echo "         scripts/autorun.sh stop   # stop it before launching a different scope"
    return 1
  fi
  assert_clean_tree || return 1

  # A leftover STOP from a previous graceful stop would make the conductor exit at
  # once, which reads as "it crashed instantly" rather than "you stopped it yesterday".
  if [ -e "$STOPFILE" ]; then
    rm -f "$STOPFILE"
    echo "autorun: cleared leftover $STOPFILE sentinel"
  fi

  mkdir -p "$(dirname "$OUT")"

  # caffeinate is macOS-only. Ported repos vendor this harness (W3-15 had to
  # un-hardcode a Node pin for the same reason), so absence degrades to running
  # without sleep-inhibition rather than refusing to start.
  local -a launcher
  if command -v caffeinate >/dev/null 2>&1; then
    launcher=(caffeinate -dimsu)
  else
    launcher=()
    echo "autorun: caffeinate not found — running without sleep-inhibition"
    echo "         (fine on Linux/CI; on a laptop keep it plugged in and awake)"
  fi

  nohup "${launcher[@]}" bash scripts/supervise.sh "$@" >> "$OUT" 2>&1 &
  local supervisor=$!
  echo "$supervisor" > "$PIDFILE"

  echo "autorun: started — supervisor pid $supervisor"
  [ "$#" -gt 0 ] && echo "         args: $*"
  echo "         log:  tail -f $OUT"
  echo "         stop: scripts/autorun.sh stop"
}

cmd_stop() {
  # STOP first: the conductor checks it between tickets, so an in-flight ticket
  # finishes and lands rather than being cut off mid-gate.
  touch "$STOPFILE"
  echo "autorun: wrote $STOPFILE — the conductor stops between tickets"

  local pid
  if pid="$(supervisor_pid)"; then
    kill "$pid" 2>/dev/null && echo "autorun: signalled supervisor pid $pid (no relaunch on crash)"
  else
    echo "autorun: no live supervisor"
  fi
  rm -f "$PIDFILE"
  echo "autorun: an in-flight ticket may still be finishing — watch $OUT"
}

cmd_status() {
  local pid
  if pid="$(supervisor_pid)"; then
    echo "supervisor: RUNNING (pid $pid)"
  elif [ -f "$PIDFILE" ]; then
    echo "supervisor: not running (stale $PIDFILE — start will clean it up)"
  else
    echo "supervisor: not running"
  fi
  [ -e "$STOPFILE" ] && echo "STOP sentinel: present (a start will clear it)"

  if [ -f "$OUT" ]; then
    echo "--- last 5 lines of $OUT ---"
    tail -5 "$OUT"
  fi

  if command -v node >/dev/null 2>&1; then
    echo "--- board ---"
    node -e '
      const p = require("./plan.json");
      const by = {};
      for (const t of p.tickets) by[t.status] = (by[t.status] || 0) + 1;
      console.log(Object.entries(by).map(([k, v]) => `${k}: ${v}`).join("  |  "));
    ' 2>/dev/null || echo "(could not read plan.json)"
  fi
}

case "${1:-}" in
  start)  shift; cmd_start "$@" ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "usage: scripts/autorun.sh start [supervise args...] | stop | status"
    echo
    echo "  start    launch unattended (nohup + caffeinate + supervisor), pid recorded"
    echo "  stop     graceful: STOP sentinel between tickets, then stop the supervisor"
    echo "  status   supervisor liveness, recent log lines, board tally"
    echo
    echo "Extra args pass through to supervise.sh, e.g.:"
    echo "  scripts/autorun.sh start --waves W9 --breakpoint never"
    echo "  scripts/autorun.sh start --no-merge      # park branches for review"
    echo
    echo "Refuses to start on a dirty tree: the supervisor runs 'git clean -fd'."
    echo "--escalate is NOT default (D-018: frontier spend requires a human)."
    exit 2
    ;;
esac
