I upgraded my DeepSeek Harness coding agent from a multi-model demo into an evidence-first engineering workflow.

The pipeline still uses GPT-5.5 xhigh for architecture and independent verification, and GPT-5.3-Codex high for implementation. But the important improvements are around the models:

1. Every stage returns schema-validated output. The workflow no longer searches prose for words such as “BLOCKED.”
2. Supervised mode stops after PLAN.md and SPEC.md and requires explicit human approval before code changes.
3. Stable AC-NNN identifiers connect requirements, files, tests, and verification evidence.
4. A run manifest records the Git baseline, model routes, artifacts, and observed commands without storing secrets.
5. Dirty-file conflicts, destructive work, production mutations, and unclear decisions block the run.
6. An offline E2E simulator proves the approval gate, resume behavior, structured contracts, and model routing without spending API tokens.
7. GitHub Actions repeats the validation on Node.js 22.19 and 24.

The lesson: a high-quality coding agent is not one giant prompt. It is a set of explicit contracts, permissions, approval points, traceable evidence, and repeatable evaluations.

Source code and full tutorial:
https://github.com/sergiofigueras/deepseek-harness-sdd-agent

#AIEngineering #SoftwareEngineering #CodingAgents #OpenAI #DeepSeek #SpecDrivenDevelopment #SDD #DeveloperTools
