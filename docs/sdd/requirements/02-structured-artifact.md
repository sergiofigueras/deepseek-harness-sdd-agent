# SDD 02 - Structured capability artifact

Source: assignment 3.2. Criterion: AC-002.

## Contract

The artifact schema is `1.0.0` and includes capability identity/version/description, vendor application fingerprint, supported tenant variants, typed input/output declarations, ordered steps, risk and action metadata, checkpoint, known business outcomes, bounded recoveries, provenance, approval status, and content hash.

Locator bundles are ordered semantic candidates (role + accessible name, label, visible text, frame path) with CSS only as a final fallback. The compiler replaces observed user values with `${inputs.name}` bindings and rejects unbound sensitive literals.

## Invariants

- Inputs validate primitive type, requiredness, pattern, and sensitivity.
- Outputs name their extraction locator and expected type.
- Humans and callers can understand the contract without a model transcript.
- Only approved artifacts are eligible for unattended replay.
- Tenant overlays may replace locator candidates and base URL patterns but not capability semantics.

## Evidence

JSON Schema validation, compiler tests, a human-readable example artifact, and a deterministic canonical content hash.
