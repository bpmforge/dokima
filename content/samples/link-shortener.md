<!--
  Provenance: Dokima-native (authored for ticket W5-09, 2026-07-20)
  The built-in guided-sample idea named in docs/BLUEPRINT.md §12.3 and
  docs/design/UX_SPEC.md §8 ("a link-shortener with auth"). This file is the
  canonical, human-readable source for the sample's interview script; the
  strongly-typed InterviewSession the wizard actually posts to
  POST /api/v1/projects/:id/pipeline/run is a hand-authored copy in
  apps/web/src/onboarding/sample-data.ts (apps/web has no dependency on
  @dokima/pipeline to construct/validate the real type from this file at
  build or run time — same wall as apps/web/src/decisions/types.ts, out of
  this ticket's write_scope to add). Keep the two in sync by hand when
  either changes.
-->

# Guided sample: a link-shortener with auth

The built-in first-fifteen-minutes idea (BLUEPRINT §12.3 item 3, UX_SPEC
§8). One deliberately small product: signed-in users create short links and
see click counts. Small enough to interview, blueprint, decide, and
decompose in a few minutes on a local model; real enough that every beat
demonstrates a real discipline, not a canned screenshot.

## Interview script (phases 0-2, one question per topic — no follow-ups)

| Topic (deliverable)      | Question                                                             | Answer                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| docs/VISION.md            | In one sentence, what does this product do and for whom?              | A link shortener with per-user accounts, so a small team can create branded short links and see click counts without sharing one login. |
| docs/SCOPE.md              | What's explicitly in scope for v1, and what's explicitly out?         | In: create/manage short links, per-user auth, click counts. Out: custom domains, team roles, link expiration rules.        |
| docs/RISKS.md              | What's the biggest risk to this shipping on time?                     | Auth is the only genuinely hard part — if we scope-creep into SSO or social login, v1 slips.                               |
| docs/CONSTRAINTS.md        | Any hard constraints — budget, timeline, tech stack, compliance?      | Local-first: SQLite, no hosted auth provider — it should run offline as a fair test of the local-model story.             |
| docs/USER_PERSONAS.md      | Who's the primary user?                                                | A solo developer or small team who wants a self-hosted link shortener instead of paying for a SaaS one.                    |
| docs/SRS.md                 | What's the one non-negotiable functional requirement?                 | A signed-in user can create a short link and see how many times it's been clicked.                                        |
| docs/USER_STORIES.md        | Give one user story that captures the core loop.                      | As a signed-in user, I want to paste a long URL and get a short one back, so I can share it without exposing the original. |
| docs/USE_CASES.md           | Walk through the primary flow, start to finish.                       | Sign up, log in, paste a URL, get a short link, click it, redirect and the click count increments.                        |

## Guided beats (UX_SPEC §8)

1. Watch the interview draft each deliverable above from its one answer.
2. Run the real blueprint -> decisions -> decompose pipeline in one call: the
   model synthesizes the blueprint, then picks the technical slate option it
   recommends — this run doesn't pause for an interactive slate card. If the
   model instead raises a founder-level decision the walkthrough has no
   slate UI wired to resolve inline, you hit the same gate a real project
   does, reported honestly rather than faked.
3. Watch the board build 2-3 real tickets from the decomposed plan. Any gate
   receipts already on the sample project (real, hash-chained, never
   self-attested by the phase that produced them) are listed if present.
4. Look at the morning queue the run feeds into.

Ends by asking for the user's real idea — this project is disposable
(created under a temp path per run) and never mistaken for real project
work.
