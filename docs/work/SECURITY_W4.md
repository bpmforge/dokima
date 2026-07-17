# Security pass — wave W4 (2026-07-17T02:04:45.326Z)

```json
{
  "raw": "Fixed. The hook (`~/Code/sdlc-tooling/hooks/test-on-stop.sh`, symlinked into `~/.claude/hooks/`) now:\n\n1. Skips the test run entirely when the working tree has no unstaged or staged changes — no more forced loop after read-only/analysis turns.\n2. Uses `pnpm test` instead of `npm test` when a `pnpm-lock.yaml` is present (correct for this pnpm monorepo).\n\nThis is an uncommitted change in `sdlc-tooling` — let me know if you want it committed there. Separately, ticket **W4-07** is still genuinely blocked on `main`/`blocked/w4-07` with a real `pnpm test` failure; say the word if you want me to pick that up as its own task.\n\n"
}
```
