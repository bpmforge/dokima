# Finding lifecycle & loop-convergence policy

**Status:** design (from conductor field-report lessons, 2026-07-12) · feeds FR-L6/FR-L7, tickets W3-08/W3-09
**Question answered:** the coder codes; code-health + security review and flag items; reports go back to the coder; fixes happen; recheck. It either clears or loops. A loop can fail two different ways — *it didn't actually fix it*, or *the fix moved things forward and uncovered new items*. How many loops is too much, and are those two cases the same?

**They are not the same, and treating them the same is the root defect.** The weekend run hit both: W0-02/W0-05 looped on the *same* finding across attempts (stall), while W1-01's finding count went 2 → 9 → 15 (the reviewer discovering more as the work got more complete — progress that *looked* like divergence). A flat attempt cap (ours was 3) punishes progress and indulges stalls equally. The budget must be keyed to **what kind of loop this is**, which requires findings to have identity.

---

## 1. Finding identity — the prerequisite

Nothing below works if findings are anonymous per-pass strings. Every HIGH/CRITICAL gets a **finding record** at first sighting:

```
finding {
  id:            F-<ticket>-<n>          // stable for the ticket's lifetime
  fingerprint:   hash(file, category, normalized-issue-text)
  severity, file, issue, fix_hint
  state:         OPEN | FIX_ATTEMPTED | RESOLVED | REGRESSED
  first_seen:    pass #
  attempts:      # of coder passes that explicitly targeted it
  history:       [(pass, state, evidence)]
}
```

Each recheck must return a **per-finding verdict** (RESOLVED-with-evidence / STILL-PRESENT-with-evidence), not just a fresh findings list. New findings open new records. This is the ledger the sticky-review already approximates; formalizing it is ticket W3-08.

## 2. Classifying each loop iteration

After every recheck, the iteration is classified by what happened to the ledger:

| Class | Ledger signature | Meaning |
|---|---|---|
| **CLEARED** | all OPEN → RESOLVED, no new | done — merge path |
| **STALLED** | ≥1 finding STILL-PRESENT after a pass that explicitly targeted it | the fix didn't fix it |
| **PROGRESSED** | all priors RESOLVED, but new findings opened | fix moved the frontier; review sees deeper |
| **MIXED** | some resolved, some still-present, maybe new | partial stall — the still-present ones govern |
| **OSCILLATING** | any RESOLVED finding reappears (→ REGRESSED) | fixes are fighting each other — worst signal |

## 3. The budgets — different for each class

### Stalls (same error, same coder tier): 2 strikes, then escalate — never 3
A finding that survives **two targeted fix attempts at the same model tier** is a wrong-approach signal, not a needs-more-tries signal. The third identical attempt is the least valuable spend in the whole system (weekend evidence: same-tier retries on a stalled finding never cleared it; only escalation or a human did).

```
attempt 1 (tier T) fails → attempt 2 (tier T, with the reviewer's evidence quoted) →
still STILL-PRESENT → escalate one rung (R2/R3) → one attempt at the higher tier →
still STILL-PRESENT → BLOCK with the finding ledger. Total: ~3 attempts across 2 tiers.
```

### Progress loops (new errors each pass): budget by convergence, not by count
New findings after a real fix are **healthy** — the reviewer can now see past the old defect (W1-01's 2→9→15 was the reviewer enumerating the missing pieces of an incomplete import, i.e., doing its job). Don't cap these at the stall number. Instead:

- **Convergence check:** over any sliding window of 2 passes, `open_findings` must strictly decrease OR the pass must be classified PROGRESSED (priors resolved). Two consecutive passes with non-decreasing open count and no prior-resolutions = **divergence → stop**.
- **Hard ceiling** so a slowly-converging ticket can't eat the night: `max_passes = base(3) + ticket_points`, capped at 8 **on frontier/metered tiers**. **Tier-aware:** on local/owned-hardware tiers (tokens ~free) the PROGRESSED ceiling rises to 12+ — the proven localFrontier setting, where 12 iterations landed complete SDLCs on local models that a flat cap of 3 hard-escalated; the session watchdog (wall-clock) is the backstop, not the pass count. Field principle from the original opencode/Jarvis local runs: *as long as it is not looping on the same error, let it loop and fix.* Hitting the ceiling while still PROGRESSED is a **park, not a failure** — the ticket is decomposing badly (too big), which is a planning signal: split it.

### Oscillation: zero tolerance
A REGRESSED finding (fixed, then broken again by a later fix) means the coder's changes conflict with each other — more same-tier loops make it worse. **One oscillation → immediate escalation; second → block.** Also record it as a decomposition signal: two findings whose fixes collide usually straddle a module boundary that the ticket blurs.

### Infra events are never findings
A truncated review, an unparseable verdict, a provider-limit pause mid-review (W2-03's false block): retry the *review*, don't charge the *coder*. Infrastructure failures must not consume fix attempts or open finding records.

## 4. So — "how many loops is too much?"

There is no single number; the honest answer is a matrix:

| Situation | Budget |
|---|---|
| Same finding, same tier | **2** targeted attempts |
| Same finding, after escalation | **+1** (then block with ledger) |
| New-findings-each-pass, converging | up to `3 + points` passes (cap 8) |
| Open count flat/rising for 2 passes | stop now (divergence) |
| Any finding regresses | escalate now; twice = block |
| Review itself failed (infra) | free retry, no charge |

The single most important rule: **the third same-tier attempt at the same finding is always wrong** — escalate or ask. And its mirror: **never kill a loop that is still resolving priors just because new findings appeared** — that's the system working.

## 5. Provenance / prior art

This refines mechanisms that already exist in the source systems rather than inventing new ones: the gap-checksum no-progress kill (detects *identical* gap sets; this adds the stall-vs-progress distinction on *finding identity*), Ralph/fix-verify loop caps (flat 3; this makes the cap class-dependent), and the Challenger's CONFIRMED-tracking (this generalizes it to a per-finding ledger with REGRESSED). The bootstrap conductor's sticky-findings mechanism is the v0; W3-08 is the v1.
