# Escalation policy

Each role (coding-agent, reviewer, challenger, ...) can escalate from its
default model to a stronger one when it gets stuck or a gate keeps failing.
This panel controls *how* that happens, per role:

- **Ladder** — escalate one rung at a time (R1 -> R2 -> R3) as retries fail.
  Cheapest by default, slowest to recover from a genuinely hard ticket.
- **Locked** — never escalate. The role stays on its assigned model no
  matter how many times a gate fails. Use this when you want a hard budget
  ceiling more than you want the ticket to finish tonight.
- **Token-gated** — escalation is available but requires an explicit token
  (a one-time human approval) before the role is allowed to call a more
  expensive model. Good middle ground: cheap by default, an intentional
  choice to spend more.

The "why this value" view under each role shows which scope (global,
project, or role override) is actually winning — settings compose, so the
value you see here isn't always the one you last typed.

Related: the model matrix picks the *default* model per role; escalation
policy only controls what happens after that default isn't cutting it.
