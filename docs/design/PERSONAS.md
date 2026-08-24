# The Org — persona roster (D-028, W20)

Personas are presentation over real actor ids — never identity, never a
claim (D-028). Names are role-flavored (founder choice 2026-08-24): each
hints at the job so a card is self-explaining without a subtitle.

Avatar keys are stable identifiers; W20-01 renders them as emoji, W20-08
maps the same keys to sprites. Job lines are the human sentence a novice
reads first — VOCABULARY.md tone, no role slugs.

## Core pipeline roles

| Role (actor/matrix id) | Persona | Avatar key | Job line |
|---|---|---|---|
| pm-interviewer | **Ida** | `ida-interviewer` | Asks you the questions that turn an idea into a plan. |
| researcher | **Scout** | `scout-researcher` | Digs up what's already known before anyone builds. |
| architecture-designer | **Blue** | `blue-architect` | Draws the blueprints — how the pieces fit before they exist. |
| api-designer | **Dex** | `dex-api` | Designs the contracts the pieces talk through. |
| ux-engineer | **Sketch** | `sketch-ux` | Shapes what you'll actually see and touch. |
| threat-modeler | **Locke** | `locke-security` | Asks "how could this go wrong?" before it can. |
| test-engineer | **Tess** | `tess-tests` | Writes the checks that prove the work does what it claims. |
| coding-agent | **Sam** | `sam-builder` | Builds the tickets — the hands on the keyboard. |
| release-manager | **Shipp** | `shipp-release` | Gets finished work out the door, notes and all. |

## Verification & challenge (maker ≠ verifier, Law 5)

| Role | Persona | Avatar key | Job line |
|---|---|---|---|
| challenger | **Wiggum** | `wiggum-challenger` | Tries to break every claim before you have to trust it. |
| phase-gate-runner | **Vera** | `vera-verifier` | Runs the gates and mints the receipts — nobody grades their own homework. |
| code-review cluster (anti-slop-auditor, …) | **The Review Bench** | `bench-review` | A panel of specialists who each read the work through one hard lens. |

Wiggum is canon — this project's challenger loop already carried the name.

## Fallback rule (mechanism-true)

Any actor id with no persona row renders **as its raw id** (W20-01
acceptance). Content-pack specialists beyond the Review Bench render
their expert display name from the pack, unpersonified. A fabricated
person is worse than a slug.

## The founder

The human is not a persona. Surfaces address them as "you"; their
identity stays `operator` in the ledger (D-020).
