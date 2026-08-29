# SAST baseline — first honest scan (W21-98)

Recorded 2026-08-29. Engine `opengrep`, 120 rules, 2062 git-tracked files,
**729 findings**, 11 partial-parse errors. The scan before this ticket's fixes
found 730 across 2051 files; `bpm-slop-fallback-hides-failure` went 34 → 30 as
the four sites below were corrected, which is the drift mechanism working on
its own first use. Machine-readable counts live in
[`sast-baseline.json`](./sast-baseline.json); this file is the reasoning behind
them.

## Why a baseline at all

Every earlier "clean" from `semgrep-full-audit.sh` was void: it exited 0 having
scanned **zero** files, because one malformed rule file aborted the whole config
load and the script judged success on the exit code alone. So this is not the
first scan — it is the first one whose result means anything.

A 730-finding wall is not actionable, and a scan nobody acts on is the same as
a scan nobody runs. The baseline exists so the **next** scan shows *drift*: a
rule above its recorded number is new work, everything at or below it is the
triage below, already done. That is what makes the number usable without
deleting findings to get it down.

## Running it

```
bash ~/.claude/scripts/semgrep-full-audit.sh --offline
```

Output goes to `docs/security/`. The raw `semgrep-results.json`/`.sarif` are
git-ignored — 2.2MB, rewritten every run, and they embed every matched source
line including fixture credentials. Update the two tracked files here when the
triage genuinely changes, not on every run.

**It is not in any gate, and that is a real gap.** Law 3 is lint + typecheck +
test + e2e + `pnpm validate`; nothing invokes SAST. This backlog accumulated
unseen for exactly that reason, and the broken script hid it for as long as it
existed.

## The 6 HIGH findings are all false positives

Checked individually, none actioned:

- **4× `fetch-user-url` (SSRF)** — test harnesses fetching their *own* localhost
  server: `fake-model-gateway.test.ts`, `app-harness.mjs`, `run-dogfood.mjs`.
- **2× `math-random-security`** — `Math.random()` naming a temporary
  *directory*, not minting a token.

## The rule that is 62% of the output

`fs-read-user-input` fires **453 times** (450 before this ticket added test
files that read files): 376 in tests, 55 in product source, 17 in
scripts/content/docs, 2 in e2e.

The 55 product hits read files under a repo root **the user chose**, which is
what a local-first developer tool is *for*. Traversal is separately guarded
(`DOKIMA_WORKSPACE_ROOT`, W13-64/session guards). The rule encodes a server
threat model — untrusted request → filesystem — and this process has no
untrusted requester; the person running it already owns the files.

**It is not excluded, and cannot be from here.** The rule pack lives in
`~/.claude/.semgrep`, shared across every project on the machine, so silencing
it for this repo would silence it for repos where it *is* the right rule.
`.semgrepignore` is path-based and cannot scope a single rule. So the baseline
carries the number instead: 453 is the known, reasoned position, and 470 next
month is a question worth asking.

## Empty-catch and fallback-hides-failure — the real signal

72 findings, **44 in product source across 35 files**. Every one was read. They
divide three ways:

**1. The failure IS the answer (majority).** `JSON.parse` → `null` on
unparseable input; `new URL()` → `null` on a non-URL; `process.kill(-pid)` on a
group that has already exited; a canvas context jsdom refuses; an optional
config file that is absent. There is no hidden error here — the catch *is* the
predicate, and the caller handles `null`. Correct as written.

**2. Documented degradation.** `localStorage` in private mode, an absent global
playbook DB (FR-F5 degrades to local-only), a repo `git ls-files` cannot read,
`readdir` on a directory that is not there. Each already carries a comment
saying which failure it is absorbing and why that is safe. This is the
"honest-empty" pattern the codebase has drawn deliberately, and the rule fires
on the *shape* rather than the meaning.

**3. Genuinely hiding a real failure — two sites, both fixed by this ticket.**

- `apps/server/src/api/server/chat-projection.ts` — `chatEnvelopesForProject`
  documented "absent DB → empty stream (truthfully)" and then caught
  *everything* from `openEventLog`. A corrupt database, a permissions error and
  a schema mismatch all rendered as the same silent "no chat yet". It now
  re-checks the path and reports anything that is still there and still will not
  open — the distinction `computeProjectStats` already draws (W21-77).
- `apps/server/src/api/server/providers-store.ts` (×3) — all three readers
  distinguished "nothing configured" from "configured but unreadable" *in the
  code* (`raw === undefined` is exactly that test) and then discarded it,
  returning the same empty array. A user whose registry had gone invalid saw a
  Settings panel reporting no providers configured — the one thing that was
  certainly untrue, and the CLI/GUI divergence that module's header exists to
  prevent. The reason now leaves the process.

Both still degrade to empty. Neither throws: the Chat pane and Settings must
not take the page down. They report; they do not recover.

## The 11 partial parses are an upstream bug

21 individual lines across 11 files are invisible to the scan — every one a type
signature, not logic. The rules still run on those files.

Pinned, and **not fixable from our config**: a rule declaring `languages:
[javascript]` makes opengrep parse `.ts` files with the *JavaScript* parser,
which cannot read TypeScript's inline `import('../types.js').SomeType` in a type
position. Our packs declare both languages, so the javascript pass fails on
every TS file using that construct.

`semgrep` runs the identical rule over the identical file with **zero** errors;
opengrep emits a syntax error. Verified both ways on a two-rule repro. Two
workarounds were tested and both fail — a `paths.include` filter still errors
(opengrep parses per-language *before* path filters apply), and splitting rules
by language fails for the same reason.

Accepted, and reported upstream. Switching back to `semgrep` for TS trees would
reintroduce exactly the rule-licensing problem the move to opengrep was made to
avoid, so it is not the answer.
