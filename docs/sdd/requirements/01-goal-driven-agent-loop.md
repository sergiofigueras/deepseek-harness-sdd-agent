# SDD 01 - Goal-driven agent loop

Source: assignment 3.1. Criteria: AC-001, AC-009.

## Decision

Use Playwright Chromium behind a `Surface` interface. Discovery observations combine URL/title, a bounded accessibility-oriented inventory of visible interactive controls and text, plus a screenshot path. The LLM receives no raw secrets and must return one strict action object: navigate, click, type, read, wait, complete, or escalate.

The loop enforces wall-clock timeout, maximum steps, repeated-observation dead-end detection, policy checks, and post-action observation. `complete` is accepted only when a declared assertion can be checked against the current surface.

## Acceptance examples

- Given goal "look up member 12345 and read the savings balance", the model opens the live target, types the parameter, submits search, reads the synthetic balance, and completes.
- Three identical observation fingerprints without progress escalate instead of looping.
- Timeout and step limit return explicit stopped results and intervention context.

## Evidence

Live JSONL events include observation hashes, model rationale summaries, policy decisions, actions, and completion. A screenshot proves the UI state without making screenshots the replay contract.
