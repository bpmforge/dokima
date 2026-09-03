# Dokima

**Idea → secure, working product.** A local-first workbench where AI agents do
the building and _the platform_ holds the gates — not the agents.

You describe what you want. Dokima interviews you, writes the blueprint,
decomposes it into a ticket board, and works the board with expert agents:
cheapest model first, escalating only when it has to. Every state change has
to earn a receipt. Nothing grades its own homework.

It runs on your machine, against your own models — a local LM Studio or Ollama
box is a first-class setup, not a downgrade. No account, no network required.

![The morning queue — one review for everything that happened overnight](docs/tour/img/09-morning-queue.png)

---

## Quickstart

Requires **Node 22** and **pnpm 11**. Nothing else — storage is SQLite, and no
external service is needed.

```sh
git clone <this-repo> dokima && cd dokima
pnpm install
pnpm build
node apps/server/src/bootstrap/cli-entry.mjs
```

That boots the workbench and opens the Canvas at `http://127.0.0.1:4317`.
Run it inside a project directory and it opens (or creates) that project.

> **Not published yet.** Dokima ships as `@bpmforge/dokima`; until the first
> tag, install from source as above. To get a `dokima` command on your PATH,
> `npm link` from the repo root.

Before you trust it with anything, ask it how it's doing:

```sh
node apps/server/src/bootstrap/cli-entry.mjs doctor
```

```
[OK] port: port 4317 is free
[OK] db-integrity: no state.db yet (fresh project)
[OK] keychain: keychain read/write probe succeeded
[OK] providers: no providers configured
[OK] pack-signatures: manifest + all file hashes verified
[OK] worktree-orphans: no worktrees directory yet
doctor: OK
```

### The rest of the CLI

Shown as `dokima <cmd>` — that's the name after `npm link`; from a plain
checkout it's `node apps/server/src/bootstrap/cli-entry.mjs <cmd>`.

| Command                                    | What it does                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `dokima`                                   | Boot the workbench and open the Canvas                                                             |
| `dokima doctor`                            | Six health checks: port, DB integrity, keychain, providers, content signatures, orphaned worktrees |
| `dokima providers refresh`                 | Re-run model discovery against your configured endpoints                                           |
| `dokima packs update`                      | Verify and install the bundled expert/validator library                                            |
| `dokima backup`                            | Online SQLite backup with retention pruning                                                        |
| `dokima service install`\|`status`\|`stop` | Run it as a background service for overnight work                                                  |

---

## What makes it different

**The gates belong to the platform.** An agent session is untrusted by
construction. It can't flip a ticket to done, can't approve its own work, and
can't talk a gate into passing — every durable state change goes through a
verb that mints a receipt. Reviewer identities and tokens are mechanically
distinct from maker ones, so "maker ≠ verifier" holds by construction rather
than by good intentions.

**The event log is append-only and hash-chained.** Projections are disposable;
the log is not. `dokima doctor` verifies the chain, and a tampered history
fails loudly instead of quietly.

**Local-first is the default, not a fallback.** Everything works with a local
model and no network. Cloud providers are an option you turn on, and
credentials live in your OS keychain as named references — never in a config
file, a prompt, or the event log.

**It ships with the expert system in the box.** 89 expert agents, 83
validators, and 26 shared protocols, each carrying provenance and a verified
signature — not prompts invented on the fly.

---

## How it fits together

| Piece                 | What it is                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fleet**             | Every project you're running, with phase, ready/blocked counts, and today's spend                                                            |
| **Canvas**            | Three panes per project — Chat (what the agents are saying), Board (Kanban with real lanes and write-scopes), Artifacts (what they produced) |
| **Harbormaster**      | Runs the board unattended: claims tickets, enforces one-per-lane, kills hung sessions, parks on provider limits and resumes                  |
| **Morning queue**     | One review for everything that happened overnight — Decide, Review, Record                                                                   |
| **Improvement plans** | Run receipts compose into ranked, verifiable proposals; accepting one mints a ticket                                                         |

Under the hood: a pnpm monorepo — `apps/server` (Fastify core + CLI),
`apps/web` (React canvas), and twelve packages (events, tickets, loop,
gateway, harbormaster, pipeline, validators, git, forge, mcp, memory, shared).
TypeScript, ESM, SQLite.

---

## Status — release candidate

The build is complete: **495 of 497 tickets done** on [`plan.json`](plan.json)
(the two left are deliberately held for founder calls — a plugin loader with
no plugin to load, and the unattended-autonomy dial). The v1.0 dogfood gate
passed (Dokima onboards itself, runs its own security cluster, and publishes
receipts under [`docs/dogfood/`](docs/dogfood/)); the packaged CLI installs
and runs on a clean machine; and a guided sample project has been driven from
the setup wizard through interview, blueprint, founder decisions, board, build
runs, machine review and acceptance on local models only, end to end.

The gaps an earlier version of this section listed are closed, each with a
ticket behind it: provider/model selection is wired to every model call, per
role (W10-03/45); the visual design has a token system and no raw hexes
(W10-06/28/30/32); the bundled expert library is at upstream `attest` v3.5.1
(W12-07); `dokima --help` prints help and no command boots a server by
accident (W10-44/W13-33); and the name is Dokima, shipping as
`@bpmforge/dokima` (D-021).

**What remains before the first tag is not build work:** the npm package is
prepared and verified (`npm pack` → install into a clean project → boot), and
publishing it is an authenticated operator step. Until then, install from
source as above. Progress ledger: [`docs/STATUS.md`](docs/STATUS.md);
release checklist: [`docs/RELEASE_TRACKER.md`](docs/RELEASE_TRACKER.md).

See the full [screenshot tour](docs/tour/TOUR.md) for what's built today.

---

## Documentation

|              |                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Design       | [BLUEPRINT](docs/BLUEPRINT.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DECISIONS](docs/DECISIONS.md) |
| Contracts    | [SRS](docs/SRS.md) · [API_DESIGN](docs/API_DESIGN.md) · [DATABASE](docs/DATABASE.md)                   |
| Security     | [THREAT_MODEL](docs/THREAT_MODEL.md) · [SECURITY_CONTROLS](docs/SECURITY_CONTROLS.md)                  |
| Operating it | [DEPLOYMENT](docs/DEPLOYMENT.md) · [TESTING](docs/TESTING.md) · [ROADMAP](docs/ROADMAP.md)             |

Contributing agents start at [`MASTER_PROMPT.md`](MASTER_PROMPT.md) →
[`plan.json`](plan.json) → [`PLAYBOOK.md`](PLAYBOOK.md), and the house rules
are in [`CLAUDE.md`](CLAUDE.md).

---

## License

**[FSL-1.1-ALv2](LICENSE)** © 2026 Bradford Matthews — the
[Functional Source License](https://fsl.software/), which becomes Apache-2.0
two years after each release.

In plain terms: **use it.** Run it at work, run it on client projects, modify
it, self-host it, build on it. The one thing you may not do is offer Dokima —
or something substantially like it — to others as a competing product or
service. Two years after any given release, that restriction lapses and the
release is Apache-2.0 forever.

`content/` (the bundled expert library and validator pack) is imported from the
`attest` project and stays under [Apache-2.0](content/LICENSE).
