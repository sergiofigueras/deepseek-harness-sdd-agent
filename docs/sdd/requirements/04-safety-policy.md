# SDD 04 - Safety, allowlists, risk, and redaction

Source: assignment 3.4. Criteria: AC-004, AC-005.

## Policy

Policy configuration names allowed origins, route patterns, action types, maximum text length, and risk handling. Navigation is checked both before and after redirects. Safe/reversible actions may proceed. Risky actions require a run-bound approval token. Irreversible actions default to denied and cannot be enabled by model output.

## Data handling

Sensitive input declarations are redacted as `[REDACTED:<field>]`. The redactor recursively handles objects/arrays and masks common API keys, bearer tokens, passwords, emails, and long numeric identifiers in free text. Raw model responses, credentials, cookies, storage state, and full HTML are never placed in normal logs or artifacts. Failure HTML is sanitized before persistence.

## Failure behavior

Policy denials are structured failures and intervention requests. A redaction failure fails closed: the evidence payload is omitted and a redaction-error event is emitted without the original value.

## Evidence

Unit tests prove origin, route, action, and risk denials and scan all checked-in JSON/JSONL artifacts for secret-like values and the synthetic member ID.
