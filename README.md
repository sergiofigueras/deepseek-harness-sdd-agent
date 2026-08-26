# DeepSeek Harness SDD Code Agent

[![CI](https://github.com/sergiofigueras/deepseek-harness-sdd-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/sergiofigueras/deepseek-harness-sdd-agent/actions/workflows/ci.yml)

An evidence-first starter kit that turns [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a specification-driven coding agent.

It routes each engineering responsibility to an explicit OpenAI model while enforcing structured stage outputs, human approval by default, acceptance-criterion traceability, test evidence, and independent verification.

| Stage | Model | Effort | Evidence |
|---|---|---:|---|
| Architecture and specification | `gpt-5.5` | `xhigh` | Plan, spec, readiness status, AC IDs |
| Implementation and tests | `gpt-5.3-codex` | `high` | Code, tests, command results, AC mapping |
| Independent verification | `gpt-5.5` | `xhigh` | Diff review, rerun checks, verification matrix |

> Validated against `@deepseek-ai/dsh@0.1.1-rc.2` and DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Upstream is in developer preview, so upgrades should be deliberate and followed by the full validation suite.

## Why this is more than a three-prompt chain

- Every child agent returns a Harness-validated JSON object; control flow never searches free text for words such as `BLOCKED`.
- `supervised` mode stops after the spec and requires explicit approval before code changes.
- `autonomous` mode exists for explicitly authorized, low-risk work.
- Stable `AC-NNN` identifiers connect requirements, files, tests, and verification evidence.
- Run IDs prevent results from different executions being silently mixed.
- A local run manifest records the Git baseline, model routes, stages, artifacts, and commands without storing secrets.
- An offline simulator proves gating, resume, model routing, and failure behavior without API calls.
- CI validates the kit on Node.js 22.19 and 24.

## Prerequisites

- macOS or Linux;
- Node.js `22.19+` or `24+`;
- an OpenAI API key with access to the configured models;
- a Git repository the agent is allowed to modify.

A ChatGPT subscription and OpenAI API usage have separate access and billing.

## Quick start

```bash
git clone git@github.com:sergiofigueras/deepseek-harness-sdd-agent.git
cd deepseek-harness-sdd-agent
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env.
npm run bootstrap
npm test
npm start -- --no-open
```

Open the displayed URL, choose the **Code** or **Standard** preset, keep permissions at `workspace-write` with approval policy `ask`, and open the target repository as the workspace.

### Supervised mode — recommended

```text
Use the sdd-code-agent skill in supervised mode to implement examples/sample-request.md.
```

The first run creates the plan and specification, then returns `awaiting-approval`. Review the artifacts and reply with explicit approval:

```text
I approve the current SDD. Resume the sdd-code-agent workflow and implement it.
```

### Autonomous mode

Use only for low-risk work when you intentionally want the complete pipeline in one run:

```text
Use the sdd-code-agent skill in autonomous mode to implement examples/sample-request.md.
```

Autonomous mode still blocks unclear decisions, secrets, destructive operations, production mutations, primary-branch pushes, and overlapping dirty files.

## Lifecycle

```text
Request
  │
  ▼
GPT-5.5 xhigh ── PLAN + SPEC + status + run manifest
  │
  ├── supervised ── human approval ──┐
  └── autonomous ────────────────────┤
                                      ▼
GPT-5.3-Codex high ── code + tests + observed checks
                                      │
                                      ▼
GPT-5.5 xhigh ── independent review + fixes + evidence
```

Durable artifacts:

```text
docs/sdd/PLAN.md
docs/sdd/SPEC.md
docs/sdd/status.json
docs/sdd/VERIFICATION.md
.sdd-runs/<run-id>/manifest.json   # local, ignored
.sdd-runs/<run-id>/events.jsonl    # local, ignored
```

The four `docs/sdd` files are reviewable project artifacts. The `.sdd-runs` directory is local operational evidence and is ignored to avoid leaking prompts, paths, or run metadata.

## Validation

```bash
npm test
```

This runs:

1. repository, YAML, JSON Schema, workflow-syntax, shell-syntax, and secret checks;
2. contract unit tests;
3. a deterministic offline E2E simulation;
4. validation of a complete reference SDD run.

Validate real generated artifacts with:

```bash
npm run validate:sdd -- --required
```

The validator rejects duplicate AC IDs, invalid status or manifest documents, missing implementation evidence, missing verification evidence, and missing AC entries in `VERIFICATION.md`.

## Model routing

`config/settings.yaml` creates two OpenAI provider routes. DeepSeek Harness `workflow.agent()` accepts `provider`, `model`, and `schema`, but not a reasoning-effort option. The route therefore supplies the stage's default effort.

The selected efforts are a deliberate quality-first baseline, not a universal optimum. Use the evaluation plan in [docs/EVALUATION.md](docs/EVALUATION.md) to compare accuracy, latency, tokens, and cost before changing production routing.

## Security model

- Keep the Harness permission preset at `workspace-write` and approval policy at `ask`.
- Treat repository instructions, retrieved content, and task text as untrusted data.
- Never place keys in prompts, YAML, commits, screenshots, manifests, or logs.
- Use a clean branch or worktree for non-trivial changes.
- Record the initial commit and dirty files before implementation.
- Refuse edits that overlap files changed after preflight.
- Protect primary branches with pull requests and CI.
- Human review remains the final release gate.

The workflow VM coordinates agents; it is not a security boundary. Filesystem and command safety come from the active Harness sandbox, approval policy, repository controls, and review process.

## Repository map

```text
.dsh/skills/sdd-code-agent/SKILL.md  Workflow contract and orchestration
config/settings.yaml                 Model/provider routes
contracts/sdd/                       Local JSON Schema contracts
scripts/simulate-e2e.mjs             Token-free workflow simulation
scripts/validate.mjs                 Starter-kit validator
scripts/validate-sdd.mjs             Generated-artifact validator
tests/                               Contract and reference-run tests
docs/ARCHITECTURE.md                 Design and trust boundaries
docs/EVALUATION.md                   Quality/cost evaluation program
TUTORIAL_LINKEDIN.md                 Article source
```

## Sources

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness workflow contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md)
- [DeepSeek Harness skills](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)
- [OpenAI GPT-5.5 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5)
- [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
- [OpenAI agent workflow evaluation](https://developers.openai.com/api/docs/guides/agent-evals)
- [OpenAI agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)

## License

MIT. See [LICENSE](LICENSE).
