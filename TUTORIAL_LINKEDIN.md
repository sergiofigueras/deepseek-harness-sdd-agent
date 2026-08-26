# AI Crash Course — Hands-on Lab #3: Build an Evidence-First Coding Agent with DeepSeek Harness and OpenAI Models

Source code: https://github.com/sergiofigueras/deepseek-harness-sdd-agent

Asking one model to “plan and implement everything” combines too many responsibilities. Architecture, unresolved product decisions, code editing, tests, and review compete for the same context.

In this lab, we build a specification-driven development pipeline with DeepSeek Harness. Different OpenAI models own different engineering responsibilities, but model routing is only the beginning. The upgraded agent also uses structured contracts, explicit approval, acceptance-criterion traceability, Git safety, deterministic simulation, and CI.

The result is not merely a conversation. It leaves auditable artifacts:

```text
docs/sdd/PLAN.md
docs/sdd/SPEC.md
docs/sdd/status.json
docs/sdd/VERIFICATION.md
```

## What is DeepSeek Harness?

DeepSeek Harness, or `dsh`, is an open-source agent harness with a web interface, filesystem and shell tools, local skills, child agents, and programmable workflows.

This tutorial pins `@deepseek-ai/dsh@0.1.1-rc.2` and upstream commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The project is in developer preview and warns that compatibility-breaking changes can occur, so “latest” is not a reproducibility strategy.

## Why more than one model?

| Responsibility | Model | Why |
|---|---|---|
| Plan and specification | GPT-5.5 xhigh | Cross-cutting reasoning, contracts, risks, and acceptance criteria |
| Implementation and tests | GPT-5.3-Codex high | Repository execution and agentic coding |
| Independent verification | GPT-5.5 xhigh | Diff review, risk analysis, and evidence validation |

These are OpenAI API model IDs. ChatGPT subscriptions and API usage have separate access and billing.

The routes above are a quality-first baseline. They should not be called universally optimal without an evaluation dataset. OpenAI's model guidance recommends increasing reasoning effort only when evaluations show a measurable gain, so the repository includes an evaluation program rather than treating `xhigh` as magic.

## Architecture

```text
Request
  │
  ▼
GPT-5.5 xhigh ── PLAN + SPEC + readiness status
  │
  ├── supervised ── explicit human approval ──┐
  └── autonomous, low risk only ──────────────┤
                                               ▼
GPT-5.3-Codex high ── implementation + tests + checks
                                               │
                                               ▼
GPT-5.5 xhigh ── independent review + fixes + evidence
```

State moves through repository artifacts, not fragile conversational summaries. Every run receives an ID, and every acceptance criterion receives an `AC-NNN` identifier.

## Step 1 — Prepare the environment

You need Node.js 22.19+ or 24+, an OpenAI API key with access to the configured models, and a Git repository the agent may modify.

```bash
git clone git@github.com:sergiofigueras/deepseek-harness-sdd-agent.git
cd deepseek-harness-sdd-agent
npm ci
cp .env.example .env
# Set OPENAI_API_KEY in .env.
npm run bootstrap
npm test
```

The `.env` file, local Harness home, run manifests, dependencies, logs, and build output are ignored by Git. Never put a real key in prompts, YAML, commits, screenshots, or logs.

## Step 2 — Configure model routes

`config/settings.yaml` defines two OpenAI routes. The DeepSeek Harness workflow can select a provider and model for each child agent, but it does not accept a reasoning-effort option directly. Each provider route therefore supplies its default effort.

```yaml
llm-pi-ai:
  providers:
    openai-architecture:
      apiKeyEnv: OPENAI_API_KEY
      api: openai-responses
      reasoning: xhigh
      models:
        - id: gpt-5.5

    openai-implementation:
      apiKeyEnv: OPENAI_API_KEY
      api: openai-responses
      reasoning: high
      models:
        - id: gpt-5.3-codex
```

`apiKeyEnv` is a reference. The key itself does not enter the configuration file.

## Step 3 — Define permanent engineering policy

`AGENTS.md` establishes invariants shared by every stage:

- inspect the real repository before editing;
- record the Git baseline and dirty files;
- write a decision-complete spec before code;
- stop when user-owned decisions remain unresolved;
- preserve unrelated changes;
- keep types strict;
- test changed behavior;
- report only commands that actually ran;
- never push or deploy without explicit authority.

A useful policy defines boundaries and evidence. It should not attempt to predict every shell command the model might choose.

## Step 4 — Create the project-local skill

DeepSeek Harness discovers project skills under:

```text
.dsh/skills/<skill-name>/SKILL.md
```

This project uses `.dsh/skills/sdd-code-agent/SKILL.md`. It teaches the parent agent how to invoke one foreground workflow with stage-specific agents.

The frontmatter is intentionally small:

```yaml
---
name: sdd-code-agent
description: "Implement non-trivial code through a model-routed, specification-driven workflow."
user-invocable: true
---
```

## Step 5 — Replace prose gates with structured outputs

The first version looked for the word `BLOCKED` in an agent response. That is fragile: prose may contain the word in an example, a negation, or a retrospective explanation.

The upgraded workflow passes a JSON Schema to every `agent()` call:

```javascript
const architecture = await agent(prompt, {
  provider: 'openai-architecture',
  model: 'gpt-5.5',
  schema: architectureSchema
})

if (architecture.status === 'blocked') {
  return { status: 'blocked', stage: 'plan-and-spec', result: architecture }
}
```

The implementation and verification stages have separate schemas. The workflow branches on exact enum values, and CI confirms that each inline schema uses only the subset supported by this Harness version.

## Step 6 — Add human approval by default

The skill supports three modes:

- `supervised`: write the plan and spec, then stop at `awaiting-approval`;
- `resume`: continue the approved run from its stored artifacts;
- `autonomous`: execute all stages only when the user explicitly requests it and the task is low risk.

Start with:

```text
Use the sdd-code-agent skill in supervised mode to implement examples/sample-request.md.
```

Review `PLAN.md`, `SPEC.md`, and `status.json`. If the contract is correct, explicitly approve it:

```text
I approve the current SDD. Resume the sdd-code-agent workflow and implement it.
```

This turns the specification into an engineering agreement instead of a disposable model preamble.

## Step 7 — Make acceptance criteria traceable

Every requirement receives a stable identifier:

```text
AC-001 → src/tasks/create.ts → tests/tasks/create.test.ts
AC-002 → src/tasks/get.ts    → tests/tasks/get.test.ts
```

`status.json` records where each criterion was planned, implemented, and verified. A completed run fails local validation when an AC lacks implementation evidence, test evidence, or a corresponding entry in `VERIFICATION.md`.

## Step 8 — Record a safe run manifest

Each run creates local operational evidence:

```text
.sdd-runs/<run-id>/manifest.json
.sdd-runs/<run-id>/events.jsonl
```

The manifest records the request hash, approval mode, initial Git commit, dirty files, stage routes, commands, and artifacts. It must be compact and redacted. The directory is ignored by Git to reduce the chance of publishing prompt data or local paths.

The run ID must remain identical across stages. If it changes, the workflow blocks instead of mixing evidence from different executions.

## Step 9 — Enforce worktree and permission safety

Prompt instructions are not a security boundary. Keep the active Harness permission preset at `workspace-write` with approval policy `ask`, and use a clean branch or worktree for non-trivial work.

The architecture stage records dirty files and declares allowed paths. The implementation stage refuses edits that overlap files changed after preflight. Autonomous mode still blocks secrets, destructive commands, production mutations, primary-branch pushes, and unclear product decisions.

Human review remains the final gate.

## Step 10 — Test the orchestrator without API tokens

Model-backed end-to-end tests are valuable but variable and expensive. They should not be the only CI signal.

The repository includes a deterministic simulator:

```bash
npm run simulate:e2e
```

It extracts the real JavaScript workflow from `SKILL.md`, supplies fake schema-conforming child responses, and proves that:

- supervised mode stops before implementation;
- resume without approval is rejected;
- approved resume runs implementation and verification;
- autonomous mode routes GPT-5.5 → GPT-5.3-Codex → GPT-5.5;
- a blocked architecture never reaches code;
- mismatched run IDs block completion;
- workflow schemas stay inside the Harness-supported subset.

This test proves orchestration logic, not model quality. Live model quality belongs in an evaluation program.

## Step 11 — Add CI and artifact validation

Run the complete local suite:

```bash
npm test
```

GitHub Actions repeats it on Node.js 22.19 and 24 and runs ShellCheck. The suite validates required files, YAML, JSON Schemas, workflow syntax, shell syntax, secrets, contract behavior, the offline E2E simulation, and a complete reference SDD run.

After a real agent run:

```bash
npm run validate:sdd -- --required
```

## Step 12 — Evaluate model quality instead of assuming it

`docs/EVALUATION.md` defines a 20–50 task program covering normal changes, ambiguity, regression, security, migrations, concurrency, dirty worktrees, adversarial repository instructions, and impossible requests.

Evaluate architecture, implementation, and verification independently. Measure:

- correct ready-versus-blocked decisions;
- acceptance-criterion coverage;
- test pass and regression rates;
- unrelated files touched;
- security issue detection;
- tokens, latency, retries, and cost.

Compare reasoning efforts on the same dataset. Higher effort is justified only when it produces a measurable quality gain worth its latency and cost.

## Common pitfalls

- **Using `latest` with a developer-preview harness:** pin a version and test upgrades deliberately.
- **Calling API models “ChatGPT”:** ChatGPT, Codex, and OpenAI API access are different product surfaces.
- **Putting secrets in YAML:** store only the environment-variable reference.
- **Treating the spec as a task list:** a useful spec decides observable contracts, failures, security, compatibility, and acceptance criteria.
- **Using prose as control flow:** branch on validated enums, not the tone of a response.
- **Making autonomy the default:** pause for approval unless the user explicitly chooses low-risk autonomous execution.
- **Trusting “tests passed”:** require exact commands, observed results, and independent reruns.
- **Claiming model superiority without evals:** publish the dataset, graders, latency, and cost before calling a route optimal.

## Conclusion

A high-quality coding agent is not created by one enormous prompt. It is created by explicit roles, structured boundaries, durable artifacts, permissions, approval points, traceable acceptance criteria, independent verification, and repeatable evaluation.

DeepSeek Harness supplies the orchestration. The models supply stage-specific capabilities. SDD supplies the contract. The surrounding proof system is what turns those pieces into engineering.

## References

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- DeepSeek Harness workflow contract: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md
- DeepSeek Harness skills: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md
- OpenAI GPT-5.5 guidance: https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5
- OpenAI evaluation best practices: https://developers.openai.com/api/docs/guides/evaluation-best-practices
- OpenAI agent workflow evaluation: https://developers.openai.com/api/docs/guides/agent-evals
- OpenAI agent safety: https://developers.openai.com/api/docs/guides/agent-builder-safety
