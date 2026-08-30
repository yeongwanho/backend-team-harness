import test from 'node:test'
import assert from 'node:assert/strict'
import { buildComparisonMatrix, compareProviderLanes, scoreProviderCase } from '../src/evaluation/provider-comparison.mjs'

const task = {
  id: 'task-one',
  baseSha: 'a'.repeat(40),
  targetSha: 'b'.repeat(40),
  goldPaths: ['src/a.js', 'test/a.test.js']
}

test('comparison matrix pairs every selected task across providers and lanes', () => {
  const corpus = { repositories: [{ id: 'repo', tasks: [task, { ...task, id: 'task-two' }] }] }
  const matrix = buildComparisonMatrix(corpus)

  assert.equal(matrix.length, 8)
  assert.equal(new Set(matrix.map((entry) => entry.id)).size, 8)
  assert.equal(matrix.filter((entry) => entry.taskId === 'task-one').length, 4)
  assert.throws(() => buildComparisonMatrix(corpus, { taskIds: ['missing'] }), /Unknown comparison task ids/)
})

test('success at one is verification-based while historical path coverage remains a separate impact metric', () => {
  const passed = scoreProviderCase(task, {
    provider: 'codex', lane: 'bth', providerCompleted: true, verificationConfirmed: true,
    attempts: 1, elapsedMs: 100, changedPaths: task.goldPaths, impactPaths: task.goldPaths,
    ruleViolations: [], usage: { tokens: { input: 10, uncachedInput: 8, output: 5, total: 15 }, costUsd: null }
  })
  assert.equal(passed.successAt1, true)
  assert.equal(passed.changedGoldRecall, 1)

  const incomplete = scoreProviderCase(task, {
    provider: 'codex', lane: 'direct', providerCompleted: true, verificationConfirmed: true,
    attempts: 2, elapsedMs: 120, changedPaths: ['src/a.js'], impactPaths: null,
    ruleViolations: ['changed-protected-file'], usage: {}
  })
  assert.equal(incomplete.successAt1, false)
  assert.deepEqual(incomplete.failureReasons, ['required-retry', 'rule-violation'])
  assert.equal(incomplete.changedGoldRecall, 0.5)
  assert.equal(incomplete.retries, 1)
  assert.equal(incomplete.usage.tokens.total, null)
  assert.equal(incomplete.impactLocalization, null)
  assert.equal(incomplete.outcomeLocalization.recallAt20, 0.5)
})

test('paired aggregation preserves missing telemetry instead of turning it into zero usage', () => {
  const bth = scoreProviderCase(task, {
    provider: 'claude', lane: 'bth', providerCompleted: true, verificationConfirmed: true,
    attempts: 1, elapsedMs: 80, changedPaths: task.goldPaths, impactPaths: task.goldPaths,
    ruleViolations: [], usage: { tokens: { total: 20 }, costUsd: 0.1, durationMs: 70 }
  })
  const direct = scoreProviderCase(task, {
    provider: 'claude', lane: 'direct', providerCompleted: false, verificationConfirmed: false,
    attempts: 1, elapsedMs: 50, changedPaths: [], impactPaths: null, ruleViolations: [], usage: {}
  })

  const [comparison] = compareProviderLanes([bth, direct])
  assert.equal(comparison.pairedTasks, 1)
  assert.equal(comparison.delta.successAt1Rate, 1)
  assert.deepEqual(comparison.bth.usage.tokens.total, { value: 20, measured: 1, total: 1 })
  assert.deepEqual(comparison.direct.usage.tokens.total, { value: null, measured: 0, total: 1 })
  assert.equal(comparison.delta.meanImpactRecallAt20, null)
  assert.equal(comparison.delta.meanOutcomeRecallAt20, 1)
})
