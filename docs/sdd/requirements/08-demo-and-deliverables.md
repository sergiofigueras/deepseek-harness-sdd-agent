# SDD 08 - Live demo, evidence, and submission deliverables

Source: assignment Sections 4, 5, and 6. Criteria: AC-009, AC-010, AC-011.

## Proxy application

Run a local synthetic member-servicing UI on loopback. The workflow is search -> member detail -> read savings balance. It intentionally uses an iframe, table layout, labels/text instead of test IDs, and query-controlled exceptional states: not found, permission denied, expired session, known interstitial, unknown dialog, and slow response.

## CLI

- `npm run demo:discover -- --goal ... --member-id ...` performs the real model-driven run and writes a draft/approved example capability and discovery evidence.
- `npm run demo:replay -- --artifact ... --member-id ...` performs model-free replay.
- `npm run demo:offline` runs the full vertical slice with a scripted discovery-model adapter for CI; its evidence is labelled fixture and never presented as the required live run.

## Checked-in evidence

`/evidence/` contains a README inventory, a live discovery JSONL and screenshot, the resulting artifact, successful replay JSONL/result, exceptional replay JSONL/result, and failure screenshot/sanitized HTML. A generator metadata file records command, code revision, model identifier, and UTC time without keys or raw prompts.

## Required documentation

`README.md` contains prerequisites, configuration, exact demo commands, offline path, architecture map, safety limits, testing, and evidence inventory. `REPORT.md` uses exactly these top-level headings: Architecture; Artifact schema; Determinism & error handling; Heterogeneity & multi-tenant; Escalation & handoff; Safety; Cuts.
