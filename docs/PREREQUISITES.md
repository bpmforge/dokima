# Shipwright — Human prerequisites (the ONLY human steps, per wave)

Design-review 2026-07-14 (DESIGN_REVIEW.md G-21). Everything else in the build is
agent-executable; these steps need a human because they touch third-party accounts,
hardware, or credentials. Each is surfaced in-product as a Decide card at the wave
that needs it; this file is the operator's checklist form.

| # | When | Step | Consumed by |
|---|---|---|---|
| HP-1 | before W2 use of local models | Install LM Studio (or Ollama); download at least one chat model; note the endpoint URL | W2-01, FR-G1, first-run wizard |
| HP-2 | before Copilot onboarding | Have a GitHub account with an active Copilot subscription (employer-provisioned is the target case); complete the device-code flow when the wizard shows it | W2-03, D-007 |
| HP-3 | before Vertex onboarding | Have a GCP project with Vertex AI API enabled + a service-account JSON (or gcloud ADC login); know project ID + region | W2-04, D-007 |
| HP-4 | before Anthropic/OpenAI onboarding | Create API keys; enter them once — they go to the OS keychain under refs (FR-S2) | W2-02 |
| HP-5 | before W6 forge connect | Create the two machine accounts (`shipwright-maker`, `shipwright-reviewer`) on the forge; generate separately-scoped tokens (maker: push/PR/comment; reviewer: review/accept only) | W6-03, SC-03, C-4 |
| HP-6 | before W6 forge connect | Confirm you hold admin on the target repo (branch-protection setup needs it, SC-14) | W6-01 |
| HP-7 | pre-0.3 public tag | Founder decisions: LICENSE choice (Apache-2.0 vs MIT, D-006) + naming pass (shipwright.io collision, D-001/S-43) | RELEASE_TRACKER pre-public checklist |

Rules: the product never automates any HP row (account creation is out of trust scope);
a missing HP row parks the dependent ticket as `blocked-with-evidence` naming the HP id;
wizard paths (FR-S4) walk HP-1–HP-4 interactively.
