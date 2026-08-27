# Verification record

Run: `interface-cua-20260827`
Status: verified locally on 2026-08-27

## Acceptance matrix

| Criterion | Verification |
|---|---|
| AC-001 | Browser integration test covers bounded discovery and structured model-exception escalation. Genuine `gpt-5.4-mini` run `discovery-4e81c2ba-2518-4aed-8721-842aecc1300b` completed against the live local UI. |
| AC-002 | Domain tests verify parameterization, secret-literal rejection, invocation validation, content hash, approval, and JSON Schema validity. |
| AC-003 | Browser tests cover success, business outcome, validation, session expiry, permission denial, missing target, finite recovery exhaustion, and checkpoint/output execution. Replay `replay-507a5ba7-fd01-492b-9075-1d0bf10b87fe` records `modelCalls: 0`. |
| AC-004 | Domain and browser tests verify origin/route/action/text policy, risky denial, valid run-bound approval, and unconditional irreversible denial. |
| AC-005 | Redaction tests cover nested/free-text values; browser evidence assertions reject raw input control values. Repository validation scans tracked and untracked text for API-key patterns. Persisted screenshots visually show `[REDACTED]`. |
| AC-006 | Failure runs contain correlated JSONL, redacted screenshot, and frame-aware sanitized HTML. |
| AC-007 | Same-session replay evidence contains intervention request, control claim, policy-checked operator action, explicit hand-back, and resumed completion. Discovery exceptions also emit screenshot-backed requests. |
| AC-008 | Overlay tests reject semantic mutations; replay compares the observed application fingerprint with the reviewed artifact before continuing. |
| AC-009 | The Playwright integration suite drives the iframe/table/no-test-id demo and its exceptional runtime scenarios. |
| AC-010 | Evidence inventory links the genuine live discovery, its approved content hash/provenance, exact deterministic replay, and multiple failure cases. |
| AC-011 | Repository validator checks README, REPORT, seven exact report headings, evidence deliverables, schemas, and SDD artifacts. |

## Commands

```text
npm run typecheck                         PASS
npm test                                  PASS
npm run validate:sdd -- --required        PASS
git diff --check                          PASS
rg raw synthetic member/API-key patterns  PASS (no evidence matches)
```

The live discovery was intentionally separate from the fixture test path and used the real OpenAI Responses API. The production replay did not receive an API key and the replay event stream records the artifact content hash, discovery provenance, and zero model calls.
