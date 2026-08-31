import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkflowBudget } from '../src/evaluation/workflow-budget.mjs'

test('workflow budget shares remaining measured time and Claude cost across calls', async () => {
  let now = 0
  const budget = createWorkflowBudget({ provider: 'claude', timeoutMs: 1000, maxBudgetUsd: 1, clock: () => now })
  const seen = []
  const runner = async adapter => {
    seen.push(adapter)
    now += 400
    return { process: { exitCode: 0 }, metadata: { usage: { costUsd: 0.3 } } }
  }
  for (let i = 0; i < 3; i++) await budget.run(runner, { provider: 'claude', timeoutMs: 1000, maxBudgetUsd: 1 }, {}, {})
  assert.deepEqual(seen.map(a => a.timeoutMs), [1000, 600, 200])
  assert.deepEqual(seen.map(a => +a.maxBudgetUsd.toFixed(6)), [1, 0.7, 0.4])
  const stopped = await budget.run(runner, { provider: 'claude', timeoutMs: 1000, maxBudgetUsd: 1 }, {}, {})
  assert.equal(seen.length, 3)
  assert.equal(stopped.metadata.failure.code, 'workflow-provider-budget-exhausted')
  assert.equal(stopped.metadata.providerStarted, false)
  assert.equal(budget.snapshot().invocations, 3)
})

test('unknown Claude cost prevents a second call without treating missing usage as free', async () => {
  const budget = createWorkflowBudget({ provider: 'claude', timeoutMs: 1000, maxBudgetUsd: 1, clock: () => 0 })
  let calls = 0
  const runner = async () => { calls++; return { process: {}, metadata: { usage: { costUsd: null } } } }
  await budget.run(runner, { provider: 'claude', timeoutMs: 1000 }, {}, {})
  const stopped = await budget.run(runner, { provider: 'claude', timeoutMs: 1000 }, {}, {})
  assert.equal(calls, 1)
  assert.equal(stopped.metadata.failure.code, 'workflow-provider-cost-unknown')
  assert.equal(budget.snapshot().reportedCostUsd, null)
})

test('Codex has no invented dollar cap and exceptional elapsed time still consumes budget', async () => {
  let now = 0
  const budget = createWorkflowBudget({ provider: 'codex', timeoutMs: 1000, maxBudgetUsd: 1, clock: () => now })
  await assert.rejects(budget.run(async () => { now = 500; throw new Error('failure') }, { provider: 'codex', timeoutMs: 1000 }, {}, {}), /failure/)
  await budget.run(async adapter => {
    assert.equal(adapter.timeoutMs, 500)
    assert.equal(adapter.maxBudgetUsd, null)
    return { process: {}, metadata: {} }
  }, { provider: 'codex', timeoutMs: 1000 }, {}, {})
  assert.equal(budget.snapshot().dollarLimitEnforced, false)
  assert.equal(budget.snapshot().invocations, 2)
})
