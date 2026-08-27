# Computer-Use Capability Recorder

A complete local vertical slice for the Interface.ai computer-use automation assignment, built with the repository's DeepSeek Harness SDD workflow.

The system lets a model discover a workflow against a real browser UI, compiles that run into a typed and reviewable capability, and replays it deterministically with no model in the production decision loop. It also implements policy guardrails, PII-aware evidence, runtime outcome classification, and same-session human takeover/resume.

## What the demo automates

The target is a local, synthetic member-servicing console. It intentionally resembles a legacy surface: an iframe, table layout, no test IDs, and runtime states for not found, validation failure, permission denial, session expiry, known/unknown dialogs, and slow loading. It never accesses a bank, public site, real credential, or real PII.

The normal goal is:

```text
Look up the member using the supplied memberId and return the current savings balance.
```

## Prerequisites and setup

- macOS or Linux
- Node.js 22.19+ or 24+
- An OpenAI API key only for genuine discovery; replay and the complete offline test path need no model service

```bash
npm ci
npx playwright install chromium
```

Keep the key in the process environment. Do not put it in a committed file:

```bash
export OPENAI_API_KEY='your-key'
```

The live adapter uses the OpenAI Responses API with strict structured output. The model can be selected with `--model`; the demonstrated default is `gpt-5.4-mini`.

## Exact demo path

Run a genuine model-driven discovery against the automatically started local UI:

```bash
npm run demo:discover -- \
  --goal 'Look up the member using the supplied memberId and return the current savings balance' \
  --member-id 12345 \
  --artifact evidence/live-example-capability.json \
  --evidence-root evidence
```

Discovery deliberately saves a draft. Record an explicit reviewer decision, then replay without an API key or any model decision:

```bash
npm run demo:approve -- \
  --artifact evidence/live-example-capability.json \
  --reviewer your-reviewer-id
```

```bash
unset OPENAI_API_KEY
npm run demo:replay -- \
  --artifact evidence/live-example-capability.json \
  --member-id 12345 \
  --evidence-root evidence
```

Exercise explicit runtime outcomes:

```bash
# Legitimate business outcome: member_not_found
npm run demo:replay -- --artifact evidence/live-example-capability.json --member-id 00000

# Hard failure with screenshot and sanitized HTML
npm run demo:replay -- --artifact evidence/live-example-capability.json --member-id 12345 --scenario permission
```

Add `--headed` to discovery or replay to watch the same browser session. The automated handoff proof is part of the offline command and tests.

For a real manual takeover on the same headed browser session, run:

```bash
npm run demo:replay -- \
  --artifact evidence/live-example-capability.json \
  --member-id 12345 \
  --scenario unknown-dialog \
  --headed \
  --interactive-handoff
```

The automation pauses and removes its control lease. The headed browser shows the existing session while the terminal accepts audited `click`/`wait` commands; each command goes through origin, action, and declared-risk policy before Playwright executes it. Control returns only after the lease-owning operator enters `return`, and the run records before/after fingerprints.

For an artifact containing a `risky` step, replay fails closed unless the caller adds `--approve-risk`. That flag mints a five-minute approval bound to the generated run ID and only the artifact's risky action types. `irreversible` steps remain denied.

## Run without live services

This command drives the real Playwright UI but replaces only the remote model decision source with a labelled scripted fixture. It covers successful replay, business outcomes, known recovery, session expiry, validation failure, retry exhaustion, missing locators, risk approval, same-session handoff/resume, and permission-denied evidence:

```bash
npm run demo:offline
```

Fixture output is labelled `evidenceKind: fixture`; it is never represented as the required live model run.

## Architecture

```text
goal + target
    -> DiscoveryModel -> Surface observation/action -> redacted evidence
    -> CapabilityArtifact compiler + review/hash
    -> deterministic ReplayEngine -> success | business_outcome | failure
                                  -> HandoffController -> same Surface session
```

- `src/surface/`: surface-neutral contract and Playwright implementation.
- `src/discovery.ts`: bounded observe-decide-act loop and artifact compilation.
- `src/contracts.ts` and `contracts/*.schema.json`: strict runtime contracts.
- `src/replay.ts`: zero-LLM executor, bounded recovery, checkpoint/output verification, and outcome taxonomy.
- `src/policy.ts` and `src/redaction.ts`: default-deny origin/route/action/risk checks and structured/free-text redaction.
- `src/evidence.ts`: correlated append-only JSONL plus rich failure capture.
- `src/handoff.ts`: single-owner control lease and same-session operator actions.
- `src/demo/server.ts`: synthetic legacy proxy application.

See `REPORT.md` for the trade-offs and `docs/sdd/` for the master spec plus one focused SDD per requirement.

## Evidence

`evidence/README.md` distinguishes the genuine model run from deterministic and fixture runs. The checked-in set includes:

- a successful `gpt-5.4-mini` discovery log;
- the compiled live capability;
- a successful model-free replay log with `modelCalls: 0`;
- not-found, same-session handoff, and permission-denied evidence;
- a failure screenshot and sanitized HTML snapshot.

All demo records are synthetic. Input control values are masked before model observations are persisted, sensitive artifact values are parameterized, and raw model responses are not logged.

## Validation

```bash
npm run typecheck
npm test
npm run validate:sdd -- --required
```

The suite validates schemas, policy/redaction, artifact hashing and overlays, browser integration, business outcomes, recoveries, handoff ownership, richer failure evidence, existing Harness workflow contracts, and SDD traceability.

## DeepSeek Harness development workflow

The original repository remains usable as an SDD coding-agent starter:

```bash
npm run bootstrap
npm start -- --no-open
```

Its workflow now requires `docs/sdd/PLAN.md`, `SPEC.md`, the eight requirement-specific SDDs, status/manifest traceability, implementation evidence, and `VERIFICATION.md` before a run can be marked verified.

## Safety boundaries

- The default policy allows only the configured loopback origin, declared routes, and action types.
- Risky actions require a short-lived, run-bound approval; irreversible actions are always denied.
- Human session ownership does not imply risky-action approval.
- Failure HTML is sanitized, and input values are masked before every persisted screenshot even though the demo data is synthetic.
- The local control/prompt layer is not a production security boundary. Production use needs authenticated operator identity, encrypted evidence storage, retention controls, signed artifacts/overlays, and an approved provider/data-residency model.

## License

MIT. See `LICENSE`.
