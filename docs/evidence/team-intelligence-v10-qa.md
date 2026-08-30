# Team intelligence v1.0 — QA evidence

**Date:** 2026-08-30

**Branch:** `codex/team-intelligence-v10`

**Scope:** project-owned facts, structured interview contradiction candidates, explicit candidate resolution, task authoring writer handoff, Git-unmerged ledger rejection, and synthetic impact-ranking regression measurement.

## What was tested

1. Project facts accept only bounded `project.*` ids, regular project-contained Markdown sources, exact headings, and supported provider authority. Missing configuration remains optional; provider disagreement becomes `conflict`; built-in fact collisions fail.
2. Interview claims are question-scoped and bounded. Enumerated claim/fact combinations create advisory contradiction candidates. Finalization fails until each current candidate is revised away or receives an actor/reason/time resolution bound to its SHA-256 and current context-snapshot SHA-256; rebind invalidates the old resolution.
3. Task context, plan, implementation transitions, and implementation lifecycle changes have one active writer. A different actor fails until a hash-chained handoff increments the writer epoch. Reviewer approval and BTH verification remain separate signed roles.
4. A real Git merge conflict was produced from two branches that appended different task events. Task replay stopped on the unmerged index before parsing either hash chain.
5. Code-context ranking was run through the production `rankCodeContext` API against a versioned synthetic 50-node Java fixture with four requirements, five relevant paths per requirement, and 20 distractors.

## Complete deterministic gate

```text
npm run check
tests 260
pass 258
fail 0
skipped 2
duration 29.5 s
```

The skipped cases are the existing opt-in real JVM and real MySQL suites. This change does not alter their runtime or configuration.

## Focused and portability gates

```text
node --test test/interview-state.test.mjs test/interview-orchestrator.test.mjs test/cli.test.mjs
tests 27
pass 27
fail 0

node --test test/task-store.test.mjs test/cli.test.mjs \
  test/interview-orchestrator.test.mjs test/implementation-orchestrator.test.mjs \
  test/verify-task.test.mjs
tests 70
pass 70
fail 0

npm run test:windows-contract
tests 8
pass 8
fail 0
```

The Windows contract suite proves portable command/path semantics locally. It is not a native Windows execution result; hosted Windows CI remains the cross-platform proof.

## Impact regression result

```text
fixtureKind synthetic-gold
cases 4
nodes 50
relevant paths per case 5
mean Recall@5 1.0
mean Recall@20 1.0
declared floors Recall@5 >= 0.80, Recall@20 >= 0.95
```

This is intentionally labeled synthetic. It detects ranking regressions in a controlled backend graph but does not establish production localization accuracy, method-level call resolution, or downstream completion quality.

## Packaging, dependencies, and optimizer regression

```text
npm audit --omit=dev --json
vulnerabilities 0

npm pack --dry-run --json
backend-team-harness@0.9.0
entryCount 131
package size 253101 bytes
unpacked size 769909 bytes

npm run benchmark:adaptive
speedup 3.612661318451343
identityPreserved true
requiredGateCount 3
adaptiveGateCount 3
```

The adaptive result is the existing analytical fixture under its declared independent fail-fast assumptions, not a new production speed claim.

## Why this evidence is enough for the change

- The project vocabulary can now grow without giving project declarations PASS authority or allowing them to replace built-in facts.
- Contradiction handling is deterministic and auditable; prose-only semantic inference is still outside Core.
- The team boundary prevents accidental cross-actor authoring and turns divergent Git histories into an explicit recovery event instead of malformed replay.
- The ranking threshold is now executable and versioned rather than a roadmap promise.

## Remaining limits

- A source-controlled writer lease is cooperative coordination, not a distributed lock. Two disconnected clones can still diverge; BTH detects the resulting Git conflict and refuses automatic recovery.
- Reviewer resolutions and task approvals are human decisions, not proof that the underlying requirement is correct.
- Real two-developer adoption, second-backend validation, native Windows execution, and real-project impact labels remain unproven.
- The project-owned implementation adapter is still a port, not a bundled coding model or operating-system sandbox.
