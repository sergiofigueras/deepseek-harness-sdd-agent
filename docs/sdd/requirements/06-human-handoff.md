# SDD 06 - Human escalation and same-session handoff

Source: assignment 3.6. Criterion: AC-007.

## Control-transfer model

`HandoffController` owns a lease over the existing `Surface` instance. Automation requests intervention with goal/capability, step, reason, observation fingerprint, screenshot, and allowed operator actions. The state moves `automation -> pending_human -> human`. Automation blocks on a resume promise and cannot act without its lease.

The minimal operator path displays the existing headed browser and accepts terminal-mediated `click`/`wait` commands through `HandoffController`; direct unaudited browser manipulation is not the supported control path. Every operator action crosses the same policy boundary as automation. The claiming identity is bound to the lease and only it may act or return control. Before/after fingerprints and an action summary are appended to the same evidence stream. Resume requires explicit hand-back and a fresh observation; discovery compiles immediately when that observation satisfies the goal.

## Safety

Human control does not bypass origin restrictions or evidence redaction. Risk approval and session control are separate: owning the session does not automatically approve an irreversible action.

## Evidence

State-machine tests reject invalid identities, policy escapes, double ownership, and invalid transitions. Integration proof pauses discovery and replay on an unknown dialog, records a human dismissal on the same browser context, returns control, and completes.
