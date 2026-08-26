# DeepSeek Harness SDD Code Agent

A starter kit for turning [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a specification-driven engineering agent.

The workflow assigns a different model to each responsibility:

| Stage | Model | Effort | Required output |
|---|---|---:|---|
| Architecture, plan, and spec | `gpt-5.5` | `xhigh` | `docs/sdd/PLAN.md`, `SPEC.md`, and `status.json` |
| Implementation and tests | `gpt-5.3-codex` | `high` | Working code and tests |
| Verification and fixes | `gpt-5.5` | `xhigh` | `docs/sdd/VERIFICATION.md` |

The Harness coordinates these stages through its workflow capability. Every child agent works in the same repository while receiving a stage-specific model and output contract.

> Validated against `@deepseek-ai/dsh@0.1.1-rc.2` and DeepSeek Harness commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The upstream project is in developer preview. Upgrade deliberately and rerun validation after every version change.

## Prerequisites

- macOS or Linux;
- Node.js `22.19+` or `24+`;
- an OpenAI API key with access to the configured models;
- a Git repository containing code the agent may modify.

A ChatGPT subscription does not automatically include API credits. Model availability depends on your account and region.

## Quick start

```bash
git clone <YOUR-REPOSITORY-URL>
cd deepseek-harness-sdd-agent
cp .env.example .env
# Edit .env and set OPENAI_API_KEY.
./scripts/bootstrap.sh
./scripts/launch.sh
```

In the browser:

1. Open this repository as the workspace.
2. Select the **Code** preset.
3. Start a new session.
4. Ask: `Use the sdd-code-agent skill to implement examples/sample-request.md`.
5. Confirm that the agent loaded the skill and invoked the `workflow` tool.

To launch without automatically opening the browser, run `./scripts/launch.sh --no-open`.

Expected flow:

```text
user request
      ↓
GPT-5.5 xhigh ── plan + spec + readiness gate
      ↓
GPT-5.3-Codex high ── implementation + tests
      ↓
GPT-5.5 xhigh ── independent review + fixes + evidence
```

## How the configuration works

- `config/settings.yaml` declares two OpenAI routes. Each route sets a default reasoning effort because the Harness workflow accepts `provider` and `model` per child agent but does not accept `effort` directly.
- `.dsh/skills/sdd-code-agent/SKILL.md` contains the SDD contract and orchestration script.
- `AGENTS.md` is the repository-wide policy for the agent.
- `.dsh-home/` is created locally and ignored by Git; it stores runtime configuration.
- The API key remains only in `.env` or the process environment. It must never be committed.

## Using the kit inside another project

Copy these items into the target repository root:

```text
.dsh/skills/sdd-code-agent/
config/settings.yaml
scripts/bootstrap.sh
scripts/launch.sh
scripts/validate.mjs
AGENTS.md
.env.example
```

If the project already has an `AGENTS.md`, merge the policies instead of overwriting it.

## Quality gates

The agent must:

1. inspect existing code and conventions before proposing changes;
2. write a decision-complete spec with failure scenarios and acceptance criteria;
3. implement only when `docs/sdd/status.json` declares `ready`;
4. add or update tests alongside behavior changes;
5. run the smallest checks that prove the change;
6. review the diff and fix confirmed issues;
7. record real commands and results in `VERIFICATION.md`.

Validate the starter kit with:

```bash
npm test
```

## Security

- Run the Harness only in repositories you are willing to let an agent modify.
- Review permissions and destructive commands before approving them.
- Never place keys in prompts, commits, screenshots, or logs.
- Create small commits before large tasks to simplify review and rollback.
- Protect primary branches with pull requests and CI.

## Publishing assets

- Full tutorial: [TUTORIAL_LINKEDIN.md](TUTORIAL_LINKEDIN.md)
- Short LinkedIn post: [LINKEDIN_POST.md](LINKEDIN_POST.md)
- Horizontal cover: [assets/linkedin-cover.png](assets/linkedin-cover.png)
- Sample request: [examples/sample-request.md](examples/sample-request.md)

## Sources

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness provider guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models)
- [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex)

## License

MIT. See [LICENSE](LICENSE).
