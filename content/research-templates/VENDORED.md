source: bpm-opencode-experts skills/design-options/SKILL.md (adopted via docs/work/IMPROVEMENT_RECOMMENDATIONS.md R-H1)
generated-from-memory: true
divergence: DESIGN_OPTIONS_template.md adapts the skill's fixed structure -- exactly 3 options
  (Minimal/Clean/Pragmatic) compared on 6 fixed dimensions in the same order (time,
  maintainability, scalability, team fit, risk, reversibility) -- into a fill-in-the-blank
  docs/research/ report template. The source is a chat-driven agent skill that writes
  docs/DESIGN_OPTIONS_[topic].md directly; this template additionally carries FR-P8 per-claim
  citation tagging, a Sources table, and a "Claims requiring Challenger review" table that the
  source skill has no equivalent for.
files: DESIGN_OPTIONS_template.md

The other four templates in this directory (MARKET_RESEARCH, FEASIBILITY, BUILD_VS_ADOPT,
PRE_CODE_API_VERIFICATION) are original Shipwright content. Checked against
bpm-opencode-experts skills/ and agents/templates/, including skill names that could plausibly
overlap (migration-planner, architect, research) and phrasing variants ("build vs buy", "make
vs buy", "feasibility"): agents/sdlc-init-phases-0-2.md delegates a feasibility investigation
to the researcher agent as an ad hoc task (no fixed template, just a one-off prompt), and no
build-vs-adopt, market-research, or pre-code-API-verification equivalent exists anywhere in
that repo. Only design-options (above) has a real structural equivalent.
