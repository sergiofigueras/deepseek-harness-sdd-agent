# SDD 03 - Deterministic replay and runtime outcomes

Source: assignment 3.3. Criterion: AC-003.

## Execution

Replay never constructs or calls an LLM client. It validates the artifact and invocation, resolves parameter templates, authorizes each action, tries locator candidates in declared order, waits for explicit postconditions, extracts typed outputs, and verifies the final checkpoint.

## Outcome taxonomy

- `success`: checkpoint verified and all declared outputs returned.
- `business_outcome`: a declared legitimate UI state such as `member_not_found`; not retryable and not a crash.
- `failure`: policy denial, invalid invocation, target missing, permission denial, session expiry, retry exhaustion, checkpoint mismatch, or internal error. Includes run ID, step index/id, category, expected, observed, retryability, and evidence paths.

Known transient dialogs and slow loads have finite retry budgets with backoff. Session expiry and permission denial stop. Unknown dialogs and missing targets escalate rather than guessing.

## Evidence

Tests cover success, not found, one recovered interstitial/slow load, permission denial, session expiry, and missing locator. The successful replay log contains no model event.
