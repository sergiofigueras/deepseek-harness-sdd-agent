# Computer-use automation system specification

Run ID: `interface-cua-20260827`

## Scope

Deliver a small end-to-end vertical slice in this repository: natural-language discovery against a real browser surface, a reusable capability artifact, deterministic production replay, safety and evidence controls, and a real same-session human handoff seam. The proxy target is a local intentionally legacy-like member-servicing application; no real credentials or PII are used.

The detailed decision records are split by requirement under `docs/sdd/requirements/` and are normative.

## Acceptance criteria

- **AC-001:** A CLI accepts a goal and target, and a genuine LLM-driven observe-decide-act loop clicks, types, navigates, and reads a live Playwright surface until success, max steps, timeout, dead-end, policy denial, or escalation.
- **AC-002:** A successful discovery emits a validated, serializable, schema-versioned capability with typed inputs and outputs, ordered actions, robust locator bundles, tenant/app identity, risk declarations, checkpoint, and review metadata; artifacts contain parameter references rather than example-sensitive values.
- **AC-003:** Replay consumes an artifact and typed inputs without any LLM call, verifies every step/checkpoint/output, applies bounded recoveries, and returns a discriminated `success`, `business_outcome`, or `failure` result with step-level debug context.
- **AC-004:** Configurable origin/route/action allowlists are enforced before every action; risky actions require an explicit approval token and irreversible actions are blocked by default.
- **AC-005:** Secrets and sensitive fields are never persisted in artifacts or logs; structured redaction covers credentials, tokens, account/member identifiers, and free-text secret patterns.
- **AC-006:** Discovery, replay, recovery, policy, and handoff events are written as redacted JSONL; failures include at least a screenshot and sanitized HTML snapshot with correlation IDs.
- **AC-007:** Stuck, blocked, and approval states create an intervention request; automation pauses and transfers an explicit ownership lease to a human operating the same Playwright page, records the intervention, and resumes only after control is returned.
- **AC-008:** The capability and executor depend on a surface interface rather than Playwright types, and support vendor-level base artifacts plus validated tenant/version locator overlays and drift fingerprints without requiring multi-tenant infrastructure.
- **AC-009:** The repository includes a non-trivial local legacy proxy flow with normal, not-found, permission-denied, session-expired, dialog, and transient-slow states; no public service or real data is automated.
- **AC-010:** `/evidence/` contains a real model-driven discovery log and saved artifact, a model-free successful replay log, and an exceptional replay log plus richer failure evidence. Evidence identifies whether it is live or deterministic fixture data.
- **AC-011:** `/README.md` provides setup, offline mode, exact discovery/replay commands, safety notes, and limitations; `/REPORT.md` uses exactly the seven required headings and explains all design trade-offs and cuts.

## System contracts

- `Surface` owns observation and raw interaction. The discovery agent and replay engine never import Playwright directly.
- `PolicyEngine.authorize` is called before all navigation and actions. It returns a decision, never throws success-shaped errors.
- `CapabilityArtifact` is immutable input to replay. Tenant overlays are validated separately and cannot change action types, risk, parameters, outputs, or checkpoints.
- `ReplayResult` is a discriminated union. Business outcomes are not exceptions; recoveries are recorded; hard failures include observed versus expected state.
- `HandoffController` is a single-owner state machine: `automation -> pending_human -> human -> automation | completed | failed`. Only the current lease holder may act.
- Evidence stores hashes and redacted summaries by default. Screenshots are opt-in for normal steps and mandatory on failure; fixture data is synthetic.

## Data flow

Goal + target + policy -> browser session -> model observations/actions -> redacted events -> artifact compiler -> reviewed artifact -> typed invocation -> deterministic executor -> structured result + evidence. Any unsafe/stuck state routes through the handoff controller while retaining the same surface/session instance.

## Non-goals

- Production bank access, authentication, secret storage, distributed queues, a full co-browsing console, desktop automation implementation, automated deployment, or cross-tenant fleet infrastructure.
- Open-ended LLM recovery during production replay.
- Claiming that offline fixture evidence is a live discovery run.

## Security and privacy

The demo uses synthetic records only. Policy defaults deny. Origin and route checks apply after redirects as well as before navigation. Raw model responses are not logged. Environment variables are read only in memory. Artifacts may contain parameter names but never discovery values. Evidence filenames contain run IDs, not input values.

## Rollout and compatibility

This is additive to the existing DeepSeek Harness SDD starter kit. Existing validator, simulation, and fixture commands remain green. The new demo is opt-in and local. Artifact schema `1.0.0` is strict; future incompatible changes require a new major schema version and migration.
