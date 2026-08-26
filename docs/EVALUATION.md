# Evaluation program

The project must earn model-routing claims through repeatable evaluation rather than intuition.

## Objectives

Measure whether the workflow produces correct, minimal, safe, and traceable changes at an acceptable latency and cost. Evaluate each stage separately before scoring the complete pipeline.

## Dataset

Start with 20–50 representative repository tasks and expand it whenever a real failure is found. Include:

- normal features and bug fixes;
- ambiguous requirements that should block;
- changes that should reuse existing code;
- malformed inputs and missing dependencies;
- security, concurrency, migration, and compatibility risks;
- adversarial instructions embedded in repository files;
- dirty-worktree conflicts;
- impossible or unauthorized requests.

The initial seed cases live in `evals/cases.jsonl`. They contain scenarios and expected decisions, not proprietary code or secrets.

## Stage metrics

### Architecture

- correct `ready` versus `blocked` decision;
- requirement coverage and stable AC IDs;
- references to real files and symbols;
- unresolved-decision detection;
- allowed-path precision;
- security and rollback coverage.

### Implementation

- acceptance criteria implemented;
- focused tests added and passing;
- regression rate;
- unrelated files touched;
- type, lint, and build results;
- retries, tokens, latency, and estimated cost.

### Verification

- defects found versus seeded defects;
- false-positive findings;
- AC evidence completeness;
- independent command execution;
- correctness of final verdict.

## Model matrix

Keep the configured routes as the baseline, then compare reasonable alternatives. For GPT-5.5, test `medium`, `high`, and `xhigh` rather than assuming more reasoning always wins. Record accuracy, input/output tokens, wall-clock latency, retries, and cost for the same dataset.

Use pass/fail, classification, or pairwise graders where possible. Calibrate automated graders against expert human labels before using them as release gates.

## Release gate

A model or prompt change may ship only when it:

1. does not reduce safety or block-detection recall;
2. does not regress the acceptance-criteria pass rate;
3. keeps unrelated-change rate at zero;
4. has an understood latency and cost impact;
5. passes the offline orchestration suite and a representative live evaluation subset.

## Current evidence boundary

The repository currently proves deterministic orchestration, stored-artifact validation, and CI reproducibility. It does not claim a statistically superior model route until live evaluation results are published.
