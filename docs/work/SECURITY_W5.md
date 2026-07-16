# Security pass — wave W5 (2026-07-16T13:35:36.980Z)

```json
{
  "critical": [],
  "high": [],
  "medium": [
    {
      "file": "packages/pipeline/src/decompose/mermaid.ts",
      "issue": "sanitizeLabel() strips/escapes markdown emphasis, smart quotes, backticks, brackets, and literal double-quotes (closing off the mermaid-syntax-breaking vectors M001-M012 tested in mermaid.test.ts), but it never strips or HTML-encodes angle brackets (`<`, `>`). Ticket titles feeding this renderer originate from upstream design/audit passes that can be LLM/agent-authored (per this repo's own C-2/C-3 trust model, agent output is untrusted). The header for this ticket states the rendered mermaid string is destined for W4-05's artifact viewer in the web canvas once a future wiring ticket lands. If that future renderer uses mermaid.js without an explicit strict `securityLevel` (or a component that dangerouslySetInnerHTML's diagram output), an agent-authored title like `<img src=x onerror=alert(document.cookie)>` would pass through sanitizeLabel unchanged and could execute as stored XSS when the diagram is rendered in a maintainer's or reviewer's browser.",
      "fix": "Strip or HTML-entity-encode `<`/`>` in sanitizeLabel alongside the existing bracket-stripping, so no HTML/script fragment can survive into the rendered label. Additionally, document (or better, enforce via a config assertion/test) that any future browser-side mermaid render of this output must set `securityLevel: 'strict'` so DOMPurify sanitizes labels as defense-in-depth, not sole reliance on this function."
    }
  ],
  "notes": "This wave (challenger/, decompose/, modes/, phases/) is a pure policy/decision layer by explicit design — every primitive touchpoint that would mutate durable state (mintReceipt, verifyReceipt, appendEvent, renderHandoff, dispatching a real specialist HANDOFF) is an injected function parameter, never called directly, and every module header states this plainly with the write_scope reason. No hardcoded secrets, no shell/child_process string-interpolation (the one execFileSync call in mermaid.validator.test.ts uses array args against a fixed repo script path with a mkdtemp'd directory, not shell-string concatenation, so it's not command-injectable), no JSON.parse of attacker-controlled data, no new dependencies, and no object-key/prototype-pollution surface (all keyed collections use Map/Set, not plain objects). Trust-boundary discipline is notably good: decideAdvance refuses to advance without a verified gate receipt, waiver bypass is independently re-verified and hard-blocked on phases 4-5 (FR-G5, red-fixture tested), and assertChallengerModelDistinct has no override path (maker != verifier is unconditional, matching C-4). The one caveat: because these guards only exist as library functions with unimplemented seams today, they provide no actual runtime protection until a future apps-server/harbormaster wiring ticket binds them to the real @shipwright/events and @shipwright/gateway primitives — worth tracking so that gap isn't mistaken for live enforcement in the interim."
}
```
