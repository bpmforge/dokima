# Start here: implement Dokima's approved automatic build workflow

Prepared 2026-09-08 from source review of `/Users/bmatthews/Code/shipwright` at commit `307ed76288f656cb764cb1dad4dc7bd049c8ec72`.

This is a coding handoff, not a completed implementation. The founder accepted the product direction: after approving design, stories, acceptance criteria, model policy and budget, the user should get automatic coding, checks, repairs and a verified preview. Publication and protected actions remain separate decisions.

## Copy this message to the coding agent

> Work in `/Users/bmatthews/Code/shipwright`. Read this handoff's START_HERE.md and IMPLEMENTATION_PLAN.md. Follow task cards AB-00 through AB-17 in order; AB-18 is a later Attest follow-up. Read only the current card and its referenced source before coding, rather than loading the whole repository into context. Register and claim the current task using the repository's plan.json process. Implement one card at a time and prove its real production caller uses the change. Run its focused tests and the repository's required full gates. Preserve receipt freshness, maker/verifier separation, sandboxing, approved scope, model limits and main/deploy approvals. Do not create a second orchestrator, relax a failing test, or mark an unused helper complete. Update PROGRESS.md with real results after each card. Continue to the next card when green. If a genuine blocker remains, record its reproduction and exact missing fact; do not guess, disable the guard, or claim success. Do not publish, push release tags, launch paid evaluations, or contact pilot users from this handoff.

## Files in this package

- IMPLEMENTATION_PLAN.md: architecture choices, exact loop, pause table, scheduling graph, evidence contracts and release proof.
- AB-00.md through AB-18.md: small ordered implementation cards.
- tasks.json: machine-readable version of the cards. This is NOT a drop-in plan.json and must not be handed directly to the conductor.
- PROGRESS_TEMPLATE.md: template for durable session handoffs.
- REVIEW_CHECKLIST.md: completion checklist for an independent reviewer.

## Rules for the coding agent

1. Read repository `CLAUDE.md`, `MASTER_PROMPT.md`, `PLAYBOOK.md`. Their existing test and ticket rules still apply. Read `docs/DECISIONS.md` for C-5/D-020/D-032 context.
2. Start with AB-00. Do not jump to turning on the autonomy switch. Evidence and acceptance wiring must work before opting users into unattended completion.
3. Use Node 22 and pnpm 11. Verify with `node --version` and `pnpm --version`. Do not regenerate the lockfile just because your shell uses the wrong Node.
4. Preserve other people's edits. Do not reset main, delete existing worktrees, or use broad cleanup globs. Make a scoped branch following the repository/user branch rules.
5. Every coding card needs a repository ticket with its actual write scope and prerequisites. Include exports and caller files up front. Reuse/split W13-32 for its existing autonomy responsibility. Never replace the entire live board with tasks.json.
6. Proposed filenames are design suggestions; existing filenames were checked during preparation. If a responsibility already has a module, extend it. If the checkout moved, find the symbol with `rg` and record the new path. Do not create a duplicate because a filename changed.
7. Do not let file-size rules trigger an unrelated refactor. Extract one cohesive helper if necessary and include it in the ticket scope.
8. Write the failing behavior test first for trust, state, retry and scheduling changes. Then implement. Test externally visible behavior, not that your function returns its own constant.
9. All unit/integration/E2E tests use fixtures/fake providers. Live scanner smoke checks and live model evaluation are explicitly separate evidence classes. No live API calls inside CI.
10. Do not parallelize coding agents. This handoff is sequential. The concurrency being implemented is a product feature. Independent review required by the repository can run as a separate reviewer session at the prescribed gate.
11. Do not skip an independent re-run just because the maker said tests passed. Result reuse is valid only under AB-08's exact evidence key and trust rules.
12. If a card is too large for one context window, stop at a tested commit and update progress. Resume that card; do not redesign the next five cards.

## Verification commands

Run from the Dokima root. Use the focused command in the current card while editing. To verify a new Vitest case, use `--retry=0` so automatic retry cannot hide instability.

The existing full closing gate is:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @dokima/web e2e
pnpm validate
```

Run in this order for the handoff baseline. `pnpm validate` includes the temp-leak check and must run after test processes finish. AB-15 may group independent source validators only after equivalent failure behavior is proven. Until then, follow the commands above. Do not rerun all gates after every keystroke; run focused tests while developing and full gates at card closure.

If dependencies are missing, follow repository install instructions with the pinned toolchain. A missing compiler, browser or sandbox is an environment failure, not permission to skip a required test and claim green. Record baseline failures and resolve or isolate their cause honestly.

## Stop conditions

Stop only the affected card when required information is genuinely missing, a protected action needs approval, or a failure cannot be fixed within the current scope. Provide: exact failing command, error, attempted fix, preserved branch/commit and the smallest next action. Ordinary implementation choices already prescribed by this plan do not need repeated founder confirmation.

Do not activate the feature for existing users until AB-16 passes. AB-17 is the measured release proof. AB-18 is secondary; it must not delay a proven Dokima private beta.
