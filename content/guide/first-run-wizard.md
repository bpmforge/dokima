# Setup wizard

Four steps, in order, and you can back out of any of them (Cancel) without
side effects until you actually create a project:

1. **Preset** — picks the starting shape of your model matrix: all-local
   (nothing leaves your machine), hybrid (local for volume, one frontier
   provider for review), or all-cloud. You can change every individual
   role's model later in Settings -> Model Matrix; the preset just seeds
   sensible defaults.
2. **Provider** — register one model endpoint. LM Studio/Ollama-style local
   servers, any OpenAI-compatible endpoint, or Vertex AI (credential ref
   only — the raw key never touches a settings file, it lives in your OS
   keychain).
3. **Forge** — optional. Connect a git forge credential now, or skip and do
   it later from Settings. Nothing downstream requires this.
4. **Guided sample** — creates a real project, then (on the final step) runs
   a real, built-in "link-shortener with auth" idea through the whole
   program in miniature: interview, blueprint, decisions, the board, and the
   morning queue. Skippable at every stage. This is the fastest way to see
   whether your model is actually fit to hold the roles you're about to
   assign it, before you risk your own idea on it.

The wizard ends with a note on what to check tomorrow morning — the
ten-minute morning-queue habit is the actual payoff of autonomous runs.
