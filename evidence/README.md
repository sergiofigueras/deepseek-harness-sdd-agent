# Evidence inventory

All application data is synthetic. Run directories use random IDs; observations, JSONL, HTML, and screenshots redact or mask input values.

## Genuine model-driven discovery

- Run: `discovery-4e81c2ba-2518-4aed-8721-842aecc1300b`
- Model: `gpt-5.4-mini` through the OpenAI Responses API
- Log: `discovery-4e81c2ba-2518-4aed-8721-842aecc1300b/live-events.jsonl`
- Screenshots: `initial.png` before navigation and `success.png` showing the completed live UI
- Emitted capability: `live-example-capability.json`

The JSONL records model observations and decisions, surface actions, policy decisions, and `run_completed`. The artifact provenance names this run. Discovery emitted a content-hashed draft; the checked-in artifact contains the explicit `codex-independent-review` approval and a recomputed canonical hash.

## Deterministic replay of that exact artifact

- Run: `replay-507a5ba7-fd01-492b-9075-1d0bf10b87fe`
- Log: `replay-507a5ba7-fd01-492b-9075-1d0bf10b87fe/deterministic-events.jsonl`

The first event records capability ID, version, approved content hash, and discovery provenance run ID. The final event records `modelCalls: 0` and the `$1,284.44` output, making the exact live-artifact replay auditable.

## Offline repeatable proof

- Fixture discovery: `discovery-7b479b4d-73fa-4ff7-ac66-86a40d98e136/fixture-events.jsonl`
- Successful replay: `replay-a8bc2bf4-3d6d-4930-b6c5-1e8e5535a8c0/deterministic-events.jsonl`
- Business outcome: `replay-c81a9124-3d5c-455e-89ac-2ec97e558420/deterministic-events.jsonl`
- Same-session handoff: `replay-7a81a95a-6414-4b94-9bbb-db9ae9a97856/deterministic-events.jsonl`
- Permission failure: `replay-7099a74b-4e26-4008-a74b-b595c46adcf5/`
- Known-interstitial recovery: `replay-4c1606f3-9922-4af1-bd11-cfbce2973426/`
- Session expiry: `replay-4fd422ec-7a50-4ec3-af90-27d449a3c8d7/`
- Validation error: `replay-0fb373b6-77ed-4556-847d-62b10272beab/`
- Retry exhaustion: `replay-9f06540a-c57b-4fa3-936e-e4d50834b425/`
- Missing locator: `replay-8b09ed0d-9877-4ee6-9427-c22b819b2587/`
- Drift mismatch: `replay-ef6651f5-1496-46e9-a748-f5dcb4528fd6/`
- Risk denied/approved: `replay-e10ee484-4360-4d80-9052-238e302f4c94/` and its `-approved` run
- Aggregate result: `offline-demo-result.json`

Fixture discovery is explicitly labelled `evidenceKind: fixture`; it is not represented as the required live model run. The handoff log preserves one browser session ID across intervention request, claim, operator action, hand-back, and completion. Failure runs include redacted screenshots and sanitized frame-aware HTML.
