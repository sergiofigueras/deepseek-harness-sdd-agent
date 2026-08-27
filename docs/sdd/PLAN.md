# Computer-use automation implementation plan

Run ID: `interface-cua-20260827`

## Baseline and intent

- Git baseline: `363b549d3bc5d1117cd511b28ed000069a4df75e`
- Dirty files at preflight: none
- Mode: autonomous, because the user requested the complete local implementation and all decisions are reversible and repository-scoped.
- Source requirements: Interface.ai Assignment A, Sections 3, 5, and 6.

## Delivery slices

1. Define strict domain contracts for actions, locator bundles, parameters, outputs, checkpoints, outcomes, policy, evidence, and control ownership.
2. Build a deliberately legacy-like local member-servicing app with an iframe, table layout, no test IDs, and injectable runtime states.
3. Implement a Playwright surface adapter that provides a model-friendly observation and executes only policy-checked actions.
4. Implement an OpenAI-backed observe-decide-act discovery loop with max-step, timeout, dead-end, and escalation stops.
5. Compile successful discovery events into a versioned, parameterized, reviewable capability artifact.
6. Implement model-free replay with robust locator fallbacks, explicit waits, checkpoint/output verification, recovery rules, and structured outcomes.
7. Implement same-session human handoff with an ownership state machine, intervention context, browser takeover, resume signal, and evidence continuity.
8. Add redacted JSONL evidence, screenshots/HTML snapshots on failure, CLI entry points, unit/integration tests, README, REPORT, and checked-in example evidence.

## Requirement map

| Criteria | Requirement SDD | Primary implementation | Verification |
|---|---|---|---|
| AC-001 | `requirements/01-goal-driven-agent-loop.md` | `src/discovery.ts`, `src/surface/playwright-surface.ts` | discovery integration tests; live discovery evidence |
| AC-002 | `requirements/02-structured-artifact.md` | `src/contracts.ts`, `src/artifact.ts` | schema/compiler unit tests; saved artifact |
| AC-003 | `requirements/03-deterministic-replay.md` | `src/replay.ts` | success, not-found, recovery, and hard-failure tests |
| AC-004, AC-005 | `requirements/04-safety-policy.md` | `src/policy.ts`, `src/redaction.ts` | allowlist, risky-action, and redaction tests |
| AC-006 | `requirements/05-evidence-observability.md` | `src/evidence.ts` | JSONL assertions and failure screenshot/HTML checks |
| AC-007 | `requirements/06-human-handoff.md` | `src/handoff.ts`, `src/cli.ts` | ownership-transition and same-session integration tests |
| AC-008 | `requirements/07-heterogeneity-scale.md` | surface interfaces, tenant overlays | contract tests and `REPORT.md` |
| AC-009, AC-010, AC-011 | `requirements/08-demo-and-deliverables.md` | demo app, CLI, evidence, docs | exact demo commands, `npm test`, artifact inspection |

## Allowed paths

`.github/**`, `.gitignore`, `.sdd-runs/**`, `AGENTS.md`, `README.md`, `REPORT.md`, `config/**`, `contracts/**`, `docs/**`, `evidence/**`, `examples/**`, `package.json`, `package-lock.json`, `scripts/**`, `src/**`, `tests/**`, `tsconfig.json`.

## Validation commands

```bash
npm ci
npx playwright install chromium
npm run typecheck
npm test
npm run demo:offline
npm run validate:sdd -- --required
```

The live discovery command additionally requires `OPENAI_API_KEY` and is run once to produce the checked-in discovery evidence. Replay and all automated tests must not require a model API.
