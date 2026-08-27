# Architecture

The implementation is a single local Node.js process because the assignment rewards a coherent vertical slice, not premature queue or fleet infrastructure. Four boundaries carry the design. `DiscoveryModel` decides one action from a bounded observation. `Surface` owns perception and raw interaction. `CapabilityArtifact` is the immutable production contract. `HandoffController` owns the live-session control lease. The discovery loop and replay engine therefore do not depend directly on Playwright.

The target is a synthetic legacy-like web console: an outer shell embeds a table-oriented member screen in an iframe, with no test IDs and injectable runtime states. Playwright supplies reliable browser lifecycle and same-session control, while observations expose semantic control names and bounded visible text rather than the application API. This is a pragmatic middle ground: more portable than CSS-only DOM recording, cheaper and more deterministic than screenshot-coordinate-only replay, while still allowing visual/coordinate locator candidates in the schema.

Discovery uses the OpenAI Responses API with a strict one-action JSON schema. The loop enforces a timeout, maximum steps, repeated-observation dead-end detection, policy authorization before every action, and a verifiable completion output. The model's raw response is not persisted. A local scripted model implements the same interface for offline CI, clearly labelled as fixture evidence.

# Artifact schema

The `1.0.0` capability is an agent-invocable contract, not a transcript. It declares identity/version, vendor application compatibility and drift fingerprint, typed inputs/outputs, ordered actions, locator bundles with robustness notes, risk, business outcomes, bounded recoveries, a final checkpoint, provenance, review state, tenant overlay metadata, and a canonical SHA-256 content hash.

Locator candidates are ordered: role and accessible name, label, visible text, CSS fallback, then an optional fingerprint-bound coordinate. Iframe candidates are independent from controls inside the frame. This avoids a single brittle selector without pretending every legacy surface has useful semantics. During compilation, observed values equal to declared inputs become input references. Sensitive member values are therefore never embedded in an artifact. Invocation validation rejects unknown, missing, mistyped, or pattern-invalid inputs. Only approved artifacts with a valid content hash replay unattended.

Tenant overlays can change only base deployment identity and locator bundles. They cannot change action types, values, risk, outputs, checkpoints, or recoveries. This keeps specialization reviewable and prevents a tenant override from silently changing capability semantics.

# Determinism & error handling

Replay constructs no model client and logs `modelCalls: 0`. It validates the artifact/hash/review state and invocation, resolves input references, authorizes every action, tries declared locator candidates in order, applies finite recoveries, extracts typed outputs, and verifies postconditions and the final checkpoint.

The result is a discriminated union. `success` includes outputs and recoveries. `business_outcome` represents a legitimate result such as `member_not_found`. `failure` reports category, step/index, expected versus observed state, retryability, and evidence. Permission denial and session expiry stop immediately. A known interstitial can be dismissed once; a transient load uses finite waits/backoff. A missing target, unknown dialog without an operator, policy denial, or checkpoint mismatch fails explicitly rather than guessing. Failures capture a screenshot and sanitized HTML snapshot.

The implementation prioritizes runtime conditions over speculative layout healing because the target environment is described as stable UI with real operational exceptions. Drift is still guarded by artifact fingerprints, multi-candidate locators, content hashes, and tenant overlay validation.

# Heterogeneity & multi-tenant

`Surface` expresses observe, act, visible/read, failure capture, session identity, and close. Artifact actions use semantic locator bundles rather than Playwright objects. A desktop adapter can map role/name candidates to OS accessibility nodes and coordinate/image candidates to visual automation without changing discovery, replay, policy, evidence, handoff, or caller results. A hostile legacy-web adapter can add frame/window targeting while preserving the same contract.

The base artifact identifies vendor product and compatible version range. Tenant profiles would supply allowed origins, non-sensitive branding hints, app-version fingerprints, and signed locator overlays. At invocation, the policy checks the target origin/route and replay compares the observed application fingerprint with the reviewed artifact fingerprint; a mismatch blocks unattended execution. Repeated successful replays can produce a confidence signal, but never silently approve semantic changes. This supports reuse across institutions running the same vendor product without requiring one recording per tenant.

# Escalation & handoff

Every structured discovery stop—including a dead end, model/surface exception, policy denial, or timeout—produces a typed intervention request. Replay requests intervention for an unknown runtime dialog when an operator is configured; otherwise it returns an explicit failure. Requests contain run/capability/goal, current step when available, reason, observation fingerprint, redacted screenshot reference, allowed operator actions, and session lease. Risky replay is separately gated by the explicit, run-bound approval flag.

Control is single-owner: `automation -> pending_human -> human -> automation | completed`. Requesting intervention removes the automation lease. A named human claims the existing `Surface` instance; only that identity may act or hand control back. Every mediated action is pre/post-authorized by policy, and automated proof dismisses an unknown dialog through that shared session. Before/after fingerprints, session ID, operator ID, and action summary are recorded. Automation resumes only after explicit hand-back and a fresh observation; discovery can compile the artifact immediately when that observation satisfies the goal. Invalid identity or ownership transitions throw. Owning the session does not bypass policy or confer risky-action approval.

The UI is intentionally minimal. A headed browser plus terminal-mediated, policy-checked actions is enough for real local takeover; a production console would authenticate operators, stream the live browser, enforce leases server-side, and audit richer input events.

# Safety

Policy defaults deny outside the configured origin, route patterns, and action list. Navigation is checked against its destination; interaction is checked against the current URL. Safe actions may proceed, risky actions need a short-lived approval bound to run and action type, and irreversible actions are unconditionally denied by model output.

The demo uses synthetic records only. Sensitive inputs are parameterized in artifacts. Input values are masked in observations, recursive redaction covers configured field names, and free-text redaction masks API keys, bearer tokens, passwords, emails, and long identifiers. Raw model responses, cookies, storage state, and credentials are not logged. Failure HTML removes input values. Evidence uses value-free run identifiers.

These controls are defense in depth, not a regulated production boundary. Persisted screenshots mask form input values, but other page regions could still render sensitive pixels on a real system; production therefore requires approved model/provider handling, isolated browser workers, encryption, access control, retention/deletion policy, DLP review, and institution-specific allowlists.

# Cuts

Deliberate cuts are distributed queues, fleet scheduling, persistent session brokers, a polished operator console, desktop driver implementation, OCR/image matching, artifact signing infrastructure, tenant registry, authentication, encrypted evidence storage, and automated confidence promotion. They are outside the focused vertical slice, but the `Surface`, overlay, policy, evidence, and lease seams leave clear attachment points.

Next priorities would be an authenticated remote operator console, screenshot/OCR locator candidates with fingerprint calibration, signed artifact and tenant-overlay approvals, encrypted evidence retention, browser-session isolation, cross-tenant variant tests, and repeated replay stability metrics. The code does implement every core capability thinly and end to end rather than replacing any requirement with a TODO.
