// Red fixture (W3-10, SC-04 docs/SECURITY_CONTROLS.md): completion must be
// receipt-existence only — a promise-token regex over session output must fail lint.
// Verified failing via `pnpm lint:boundary-fixtures`.
export function looksDone(sessionOutput: string): boolean {
  return /DONE|PASSED|COMPLETE/.test(sessionOutput);
}
