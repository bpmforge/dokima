// conductor/prompts.mjs — reviewer and security-auditor prompt templates.
// Chapter of scripts/conductor.mjs, split under the 400-line
// CODE_BOOK_PROTOCOL cap (W10-46). Extraction only, no behaviour change.

// ---------- prompts ----------
// codingPrompt lives in conductor-lib.mjs (pure string templating, unit-tested
// there); called below with CONFIG.boardPath so the agent is told the real
// board location.

export const reviewPrompt = (t, diff, prior = [], advisory = []) => `You are an independent code reviewer (you did NOT write this code). Review the diff for ticket ${t.id} — ${t.title}.
Acceptance criteria:\n${t.acceptance.map((a) => `- ${a}`).join('\n')}

Review dimensions: correctness vs acceptance; error handling (no swallowed errors); security (secrets, injection, trust-boundary violations — this project's law: agent sessions untrusted, receipts required, maker!=verifier; for crypto/hash/integrity code verify the primitive is actually sound — e.g. a tamper-evident hash preimage must be injective/domain-separated); tests real and failing-capable (no assertion-free tests, no gamed fixtures); write-scope respected; no dead code or stub theater; matches docs/ARCHITECTURE.md module rules.
${advisory.length ? `\nDETERMINISTIC VALIDATOR FINDINGS on this diff (grep-heuristic — some are false positives, e.g. numbers inside comments/strings/status-codes, or "unreachable" on valid early-return code). ADJUDICATE each: is it a REAL defect worth a finding, or a false positive? Only raise the real ones:\n${advisory.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n` : ''}
${prior.length ? `\nPRIOR HIGH/CRITICAL FINDINGS raised on EARLIER attempts of THIS ticket. You MUST inspect the current diff and judge each one — a finding is NOT resolved merely because you would not raise it yourself; verify in the code that it was actually fixed:\n${prior.map((s, i) => `  ${i + 1}. [${s.severity}] ${s.file}: ${s.issue}`).join('\n')}\n` : ''}
Respond with ONLY a JSON object:
{"verdict":"APPROVE"|"FIX",
 "findings":[{"severity":"CRITICAL"|"HIGH"|"MEDIUM"|"LOW","file":"...","issue":"...","fix":"..."}],
 "prior_status":[{"finding":"<the issue text from the numbered list above>","status":"RESOLVED"|"PRESENT","evidence":"why — cite the code that fixes or still exhibits it"}]}
Include a prior_status entry for EVERY prior finding listed. Verdict FIX if any CRITICAL/HIGH is present in the new code OR any prior finding is not RESOLVED. Be specific; cite files.

DIFF:
${diff}`;

export const securityPrompt = (w, diff) => `You are a security auditor. Audit the combined diff of wave ${w} of this project against: OWASP relevant classes, hardcoded secrets, command/path injection (this app spawns child processes and shells out to git), trust-boundary violations (agent-session outputs must never directly mutate state; receipts required), unsafe deserialization, and dependency risks. Respond with ONLY JSON: {"critical":[...],"high":[...],"medium":[...],"notes":"..."} where each item is {"file":"...","issue":"...","fix":"..."}.

DIFF:
${diff}`;

