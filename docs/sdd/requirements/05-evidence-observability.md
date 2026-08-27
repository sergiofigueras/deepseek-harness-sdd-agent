# SDD 05 - Evidence and observability

Source: assignment 3.5. Criterion: AC-006.

## Event model

Every run has a correlation ID and monotonic sequence. JSONL events include timestamp, run/capability IDs, phase, event type, step, redacted rationale summary, action summary, policy/recovery result, and evidence references. Events are append-only and flushed after each action.

Normal runs retain bounded structured observations. Failures capture a PNG screenshot and sanitized HTML snapshot; all paths are relative and value-free. Live discovery, deterministic replay, fixture, and human actions are explicitly distinguished by `actor` and `evidenceKind`.

## Operational use

The replay result points to its log and failure assets. A reviewer can reconstruct control ownership and actions without storing the raw LLM transcript or sensitive inputs.

## Evidence

Tests parse every JSONL line, assert sequence/correlation continuity, and verify richer failure files exist and contain no forbidden data.
