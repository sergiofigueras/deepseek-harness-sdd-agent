# Architecture and trust boundaries

## Design goal

Turn a coding request into auditable repository changes without treating an agent's confidence as proof. The system separates decisions, implementation, and verification while preserving a shared filesystem contract.

## Components

| Component | Responsibility | Trust level |
|---|---|---|
| Parent Harness agent | Loads the skill, selects mode, invokes the workflow | Trusted orchestrator under active permissions |
| Architecture child | Inspects the repository and writes a decision-complete SDD | Untrusted output; schema and human review gate it |
| Implementation child | Implements only an approved SDD | Mutating; restricted to allowed paths and active sandbox |
| Verification child | Reviews the actual diff, reruns checks, fixes confirmed defects | Mutating reviewer; still requires human review |
| `docs/sdd` | Durable requirements and evidence | Versionable project contract |
| `.sdd-runs` | Run-local manifest and events | Operational evidence; ignored and redacted |
| CI | Repeats deterministic project checks | Independent machine gate |

## State machine

```text
blocked ───────────────────────────────────────────────┐
                                                      │
planned ── supervised ── awaiting_approval ── ready ──┤
   └──── autonomous ──────────────────────── ready ────┤
                                                      ▼
                                               implementing
                                                      ▼
                                                 verifying
                                                      ▼
                                                  verified
```

`verified` means ready for human review, not automatically safe to deploy.

## Structured boundaries

Every workflow child uses `agent(..., { schema })`. The workflow branches on exact enum values, not prose. Local schemas add stricter requirements for stored artifacts, including `AC-NNN` patterns and non-empty evidence.

The DeepSeek Harness workflow schema subset allows only `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, and `oneOf`. CI checks that inline workflow schemas stay inside that subset.

## Approval and resume

The workflow is foreground-only. Resume therefore means stage-boundary continuation, not recovery inside a running child call.

- `supervised` produces an SDD and stops.
- `resume` requires explicit approval and continues from the stored artifacts.
- `autonomous` skips the human spec pause only when explicitly requested.

The run ID must remain stable across stages. A changed run ID blocks the workflow to prevent cross-run evidence mixing.

## Safety invariants

- Never store credentials in repository files or run metadata.
- Keep the Harness at `workspace-write` plus approval policy `ask`.
- Treat user requests and repository text as untrusted task data.
- Record the Git baseline and dirty files before implementation.
- Refuse planned edits that overlap subsequent dirty changes.
- Never push, deploy, or mutate production without explicit authority.
- Do not weaken a test or quality gate to manufacture success.

## Known limitations

- Agent prompts cannot create a security boundary by themselves.
- The offline simulator proves orchestration logic, not model quality.
- A live provider run is optional because it requires credentials and consumes API resources.
- Model routing is a quality-first baseline until the evaluation suite establishes comparative results.
