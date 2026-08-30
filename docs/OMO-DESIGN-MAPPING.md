# OMO design mapping

## Verdict

Backend Team Harness does **not** embed, import, or copy OMO. It independently implements a small subset of general harness patterns after studying OMO's multi-harness architecture.

The useful comparison is therefore “which runtime technique has an equivalent?” rather than “which OMO module was reused?”.

## Runtime correspondence

| Harness concern | OMO reference area | Backend Team Harness implementation | Correspondence |
| --- | --- | --- | --- |
| Core / project boundary | `packages/*-core`, `packages/omo-opencode`, `packages/omo-codex`, `packages/omo-senpi` | generic `src/core/` + one configured runner + project `verification.json` | Implemented at small scale |
| Task transition audit | `packages/senpi-task/src/state/` | `src/core/task-state.mjs` | Independently reimplemented for human-reviewed backend work |
| Task persistence | `packages/senpi-task/src/store/` | `src/core/task-store.mjs` | JSONL event replay + snapshot + local lock |
| Tool registry | OpenCode adapter tool registry | `src/core/tool-registry.mjs` | Named structured dispatch implemented |
| Pre-tool guard | OpenCode `tool.execute.before` guard tier | `src/policy/tool-gate.mjs` | Deny-before-execute implemented |
| Deterministic QA evidence | OMO `.omo/evidence/` QA rule | source/input binding + fresh JUnit/Findings + canonical run/evidence history | Result contract implemented; hashes are not called signatures |
| Planning handoff | harness-specific task/prompt adapters | canonical human-approved plan digest + provider-neutral read-only JSON export | Port implemented |
| Isolated implementation | adapter-specific tool execution | project-owned adapter contract + detached worktree + explicit write/network latch | Small provider-neutral port; no model embedded |
| Failure continuation | task/continuation components | sealed failure diagnosis + bounded same-worktree repair request + full re-verification | Independently implemented; never promotes its own verdict |
| Config validation | `packages/omo-config-core` | strict verification, project-rule, and implementation contracts | Executable verification and review checklists are separate |
| Lifecycle hook system | OpenCode hook composition / Senpi components | none | Not implemented |
| Memory engine | `packages/memory-core` | none | Not implemented; Markdown context is not called memory |
| Model routing/providers | `packages/model-core`, harness adapters | none | Not implemented |
| Multi-agent/team runtime | team/delegate/task packages | none | Intentionally out of scope |
| Component composition | adapter/component composition | installable project Packs over one result contract | Small independent equivalent; no OMO code reused |

## Important product difference

OMO is an agent runtime: the agent is a primary worker and the harness coordinates tools, hooks, memory, tasks, and multiple host environments.

Backend Team Harness is a backend engineering workflow with a small optional implementation port: the project chooses the coding adapter, while BTH binds its approved plan, isolates writes, enforces a path/diff budget, runs deterministic project verification, separates executed from reported evidence, and records rerunnable results. It still is not a general agent OS.

That difference is intentional. Porting OMO's full hook count, team mode, memory engine, or model router would add complexity without proving the backend collaboration problem.

## What “OMO-inspired” may honestly mean now

It is accurate to say:

> Backend Team Harness independently adapts OMO-style state, guarded tool execution, Core/project separation, and execution-gated completion to a backend verification workflow.

It is not accurate to say:

- OMO code is reused.
- This is an OMO distribution or adapter.
- OMO's agent loop, memory, hooks, or provider routing are present.
- The two products currently have equivalent scope.

Any future direct code reuse requires a separate license and attribution review before implementation.
