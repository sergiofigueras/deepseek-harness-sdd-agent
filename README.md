# Computer-Use Capability Recorder

[![CI](https://github.com/sergiofigueras/deepseek-harness-sdd-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/sergiofigueras/deepseek-harness-sdd-agent/actions/workflows/ci.yml)

This project is a complete vertical slice of the Interface.ai computer-use automation assignment. An LLM discovers a workflow against a real browser UI, the successful run becomes a typed and reviewable capability, and production replay executes that capability deterministically without an LLM in the decision loop.

The project was developed with the repository's DeepSeek Harness specification-driven development workflow. The runtime application itself uses TypeScript, Playwright, and the OpenAI Responses API.

## What the application does

The included target is a local synthetic member-servicing console that deliberately resembles legacy banking software:

- iframe-hosted workspace;
- table-based layout;
- no test IDs;
- member lookup and balance extraction;
- not-found, validation, permission, session-expiry, loading, interstitial, and unknown-dialog states.

The default goal is:

```text
Look up the member using the supplied memberId and return the current savings balance.
```

No real bank, credentials, customer data, or external website is used.

## Prerequisites

- macOS or Linux
- Node.js 22.19 or later
- npm
- An OpenAI API key only for genuine LLM discovery

Replay, the offline demo, and the test suite do not need an API key.

Check the installed versions:

```bash
node --version
npm --version
```

## 1. Clone and install

```bash
git clone https://github.com/sergiofigueras/deepseek-harness-sdd-agent.git
cd deepseek-harness-sdd-agent
npm ci
npx playwright install chromium
```

On Linux, if Chromium reports missing system libraries, install the browser and its OS dependencies with:

```bash
npx playwright install --with-deps chromium
```

The demo commands automatically start and stop the local target application. You do not need to run the server in another terminal.

## 2. Fastest complete demo - no API key

This is the best first command. It drives the real Playwright UI while replacing only the remote discovery model with a clearly labelled scripted fixture:

```bash
npm run demo:offline -- --evidence-root .local/evidence
```

It exercises:

- discovery and artifact compilation;
- explicit artifact approval;
- successful deterministic replay;
- `member_not_found` as a business outcome;
- known-interstitial recovery;
- validation, permission, and session-expiry failures;
- retry exhaustion and a missing locator;
- application-drift rejection;
- risky-action denial and run-bound approval;
- same-session human handoff and resume.

Expected result: the command prints one aggregate JSON object. `replaySuccess.kind` and `replayHandoff.kind` should be `success`, while the injected failure cases should contain their expected failure categories.

Generated files are written under `.local/evidence/`, which is ignored by Git.

## 3. Genuine LLM discovery

Export the API key into the current terminal. Do not add it to source files or commit it:

```bash
export OPENAI_API_KEY='your-openai-api-key'
```

Run the live observe-decide-act loop:

```bash
npm run demo:discover -- \
  --goal 'Look up the member using the supplied memberId and return the current savings balance' \
  --member-id 12345 \
  --model gpt-5.4-mini \
  --artifact .local/evidence/live-capability.json \
  --evidence-root .local/evidence
```

The command automatically starts the synthetic application, launches Chromium, calls the OpenAI Responses API for each decision, and stops when the goal is complete or a stopping condition is reached.

Expected result:

- terminal JSON contains `"kind": "success"`;
- `.local/evidence/live-capability.json` is created;
- the artifact initially has `review.status: "draft"`;
- a `discovery-<uuid>/live-events.jsonl` evidence directory is created.

Add `--headed` if you want to watch the browser:

```bash
npm run demo:discover -- \
  --goal 'Look up the member using the supplied memberId and return the current savings balance' \
  --member-id 12345 \
  --model gpt-5.4-mini \
  --artifact .local/evidence/live-capability.json \
  --evidence-root .local/evidence \
  --headed
```

## 4. Approve the discovered capability

Unattended replay rejects draft or tampered artifacts. After reviewing the artifact, approve it with a reviewer identity:

```bash
npm run demo:approve -- \
  --artifact .local/evidence/live-capability.json \
  --reviewer your-reviewer-id
```

Expected result: the command prints `"status": "approved"`, the reviewer identity, and the newly computed content hash.

## 5. Deterministic replay - no LLM

Remove the key to demonstrate that replay has no model dependency:

```bash
unset OPENAI_API_KEY
```

Replay the approved capability with invocation parameters:

```bash
npm run demo:replay -- \
  --artifact .local/evidence/live-capability.json \
  --member-id 12345 \
  --evidence-root .local/evidence
```

Expected result:

```json
{
  "kind": "success",
  "outputs": {
    "savingsBalance": "$1,284.44"
  }
}
```

The complete result also includes the run ID, capability ID, timestamps, recoveries, and evidence path. Its JSONL log records `modelCalls: 0` plus the exact artifact content hash and discovery provenance.

## 6. Exercise business outcomes and failures

Use the checked-in approved example artifact if you want to run these commands without performing discovery first.

Known business outcome - exits normally with `kind: "business_outcome"`:

```bash
npm run demo:replay -- \
  --artifact evidence/live-example-capability.json \
  --member-id 00000 \
  --evidence-root .local/evidence
```

Permission failure - exits non-zero and captures a screenshot plus sanitized HTML:

```bash
npm run demo:replay -- \
  --artifact evidence/live-example-capability.json \
  --member-id 12345 \
  --scenario permission \
  --evidence-root .local/evidence
```

Additional scenarios:

| Scenario | Command option | Expected behavior |
|---|---|---|
| Success | `--scenario success` | Returns the savings balance |
| Permission denied | `--scenario permission` | `permission_denied` hard failure |
| Session expired | `--scenario expired` | `session_expired` hard failure |
| Validation error | `--scenario validation` | `invalid_invocation` failure |
| Known dialog | `--scenario interstitial` | Applies `known-interstitial` recovery |
| Unknown dialog | `--scenario unknown-dialog` | Requires human intervention |
| Slow response | `--scenario slow` | Uses bounded waiting/recovery |
| Stuck load | `--scenario stuck-loading` | Returns `retry_exhausted` |

Use `--member-id 00000` with any normal scenario to produce the `member_not_found` business outcome.

## 7. Same-session human handoff

Run replay in headed, interactive mode:

```bash
npm run demo:replay -- \
  --artifact evidence/live-example-capability.json \
  --member-id 12345 \
  --scenario unknown-dialog \
  --evidence-root .local/evidence \
  --headed \
  --interactive-handoff
```

When prompted, enter these responses one per prompt:

```text
click
Resolve manually
legacy
safe
return
```

This sequence claims the existing browser session, finds the `Resolve manually` button by accessible name inside the legacy frame, policy-checks the safe click, records it, and explicitly returns control to automation. The replay then continues in the same browser session and completes.

The operator surface also accepts `wait`. The demo operator path denies risky and irreversible commands; session ownership does not itself grant risk approval.

## 8. Run the target application by itself

This step is optional and is only useful for inspecting the synthetic UI manually:

```bash
npm run demo:server
```

Open:

```text
http://127.0.0.1:3000/app
```

Stop it with `Ctrl+C`.

## 9. Run validation and tests

Run the complete verification suite:

```bash
npm test
npm run validate:sdd -- --required
```

Or run individual checks:

```bash
npm run validate
npm run typecheck
npm run test:contracts
npm run test:assignment
npm run simulate:e2e
```

The suite validates schemas, artifact hashing and parameterization, policy and redaction, browser integration, outcome classification, recovery limits, drift detection, handoff ownership, failure evidence, DeepSeek Harness workflow contracts, and SDD traceability.

## DeepSeek Harness SDD workflow

DeepSeek Harness was used as the engineering workflow for this project. The repository requires:

- `docs/sdd/PLAN.md` and `docs/sdd/SPEC.md`;
- eight requirement-specific SDDs under `docs/sdd/requirements/`;
- acceptance-criterion ownership through `plannedIn`;
- implementation and verification evidence in `docs/sdd/status.json`;
- a final `docs/sdd/VERIFICATION.md` record.

To launch the original DeepSeek Harness web workflow:

```bash
npm run bootstrap
```

Edit the generated `.env` and replace `OPENAI_API_KEY=replace-me`, then run:

```bash
npm start -- --no-open
```

This Harness workflow is separate from the computer-use demo commands above.

## Architecture

```text
goal + target
    -> DiscoveryModel -> Surface observation/action -> redacted evidence
    -> CapabilityArtifact compiler -> human review + content hash
    -> deterministic ReplayEngine -> success | business_outcome | failure
                                  -> HandoffController -> same Surface session
```

- `src/discovery.ts`: bounded LLM observe-decide-act loop and artifact compilation.
- `src/surface/`: surface-neutral contract and Playwright implementation.
- `src/contracts.ts` and `contracts/*.schema.json`: typed and serializable runtime contracts.
- `src/replay.ts`: zero-LLM replay, recovery, checkpoint verification, and output extraction.
- `src/policy.ts` and `src/redaction.ts`: allowlists, risk enforcement, and data protection.
- `src/evidence.ts`: append-only JSONL evidence and rich failure capture.
- `src/handoff.ts`: identity-bound control lease and policy-mediated operator actions.
- `src/demo/server.ts`: synthetic legacy banking application.

See `REPORT.md` for design decisions and trade-offs, `docs/sdd/` for the complete specification set, and `evidence/README.md` for the checked-in live and deterministic proof inventory.

## Evidence and data handling

The checked-in `/evidence` directory contains:

- a genuine `gpt-5.4-mini` discovery run;
- its approved, content-hashed capability artifact;
- an auditable zero-model deterministic replay;
- business-outcome, recovery, drift, policy, handoff, and failure examples;
- redacted screenshots and sanitized HTML snapshots;
- generator metadata tying the evidence to its model, command, and code revision.

All records are synthetic. Input values are masked before screenshots are persisted, sensitive values are parameterized instead of embedded in artifacts, and raw model responses, API keys, credentials, cookies, and storage state are not logged.

## Troubleshooting

### `Executable doesn't exist` or Chromium cannot start

```bash
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium`.

### `Set OPENAI_API_KEY for a genuine model-driven discovery run`

Export the key in the same terminal that runs `demo:discover`:

```bash
export OPENAI_API_KEY='your-openai-api-key'
```

### `Only approved capabilities may replay unattended`

Run `npm run demo:approve` against the same artifact path before replay.

### Artifact content-hash mismatch

Do not edit an approved artifact manually. Re-run discovery, review the new draft, and approve it so the canonical hash is recomputed.

### The failure command returned exit code 1

That is expected for injected hard-failure scenarios such as `permission`, `expired`, `validation`, and `stuck-loading`. Inspect the structured result and the referenced files under the selected evidence root.

## Safety boundaries

- The default policy allows only the configured loopback origin, route patterns, and action types.
- Risky actions require a short-lived approval bound to the exact run and action type.
- Irreversible actions are always denied.
- Human session ownership does not imply risky-action approval.
- Input values are masked before screenshots, and failure HTML is sanitized.
- The local CLI is a demonstration boundary, not a production authentication or evidence-storage system.

## License

MIT. See `LICENSE`.
