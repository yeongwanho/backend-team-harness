import test from 'node:test'
import assert from 'node:assert/strict'
import { assertComparisonInputs, buildComparisonMatrix, compareProviderLanes, scoreProviderCase } from '../src/evaluation/provider-comparison.mjs'

const task = {
  id: 'task-one',
  baseSha: 'a'.repeat(40),
  targetSha: 'b'.repeat(40),
  goldPaths: ['src/a.js', 'test/a.test.js']
}

test('native workflow success is one user request with explicitly unknown direct internal repairs', () => {
  const base = { provider: 'codex', workflow: 'native-workflow', providerCompleted: true, verificationConfirmed: true,
    elapsedMs: 100, changedPaths: task.goldPaths, acceptance: { controlsConfirmed: true, candidatePassed: true } }
  const bth = scoreProviderCase(task, { ...base, lane: 'bth', attempts: 2, repairAttempts: 1 })
  const direct = scoreProviderCase(task, { ...base, lane: 'direct', attempts: 1 })
  assert.equal(bth.successAt1, true)
  assert.equal(bth.successUnit, 'workflow-request')
  assert.equal(bth.providerInvocations, 2)
  assert.equal(direct.retries, null)
  const [comparison] = compareProviderLanes([bth, direct])
  assert.equal(comparison.direct.retries.rate, null)
  assert.equal(comparison.direct.retries.measured, 0)
  const controlled = scoreProviderCase(task, { ...base, workflow: 'controlled-edit', lane: 'direct', attempts: 1 })
  assert.throws(() => compareProviderLanes([bth, controlled]), /success units/)
})

test('resume rejects changed execution time, cost or recovery policy fingerprints', () => {
  const expected = { corpusSha256: 'a', configSha256: 'b', mode: 'deep', model: null, executionPolicySha256: 'c' }
  const record = { case: { corpusSha256: 'a' }, fairness: { configSha256: 'b', fixedMode: 'deep', fixedModel: null, executionPolicySha256: 'd' } }
  assert.throws(() => assertComparisonInputs(record, expected), /Comparison inputs/)
})

test('native direct task acceptance alone cannot prove it executed its own validation', () => {
  const observation = { provider: 'codex', lane: 'direct', workflow: 'native-workflow',
    providerCompleted: true, verificationConfirmed: true, attempts: 1, elapsedMs: 10,
    changedPaths: task.goldPaths, acceptance: { controlsConfirmed: true, candidatePassed: true } }
  const unknown = scoreProviderCase(task, observation)
  assert.equal(unknown.successAt1, null)
  assert.equal(unknown.taskAcceptanceSuccess, true)
  assert.ok(unknown.failureReasons.includes('native-validation-unconfirmed'))
  assert.equal(scoreProviderCase(task, { ...observation, nativeValidationConfirmed: true }).successAt1, true)
})

test('resumed and aggregated comparisons cannot mix changed task/config inputs or effort', () => {
  const expected = { corpusSha256: 'a'.repeat(64), configSha256: 'b'.repeat(64), mode: 'balanced', model: null }
  const record = { case: { corpusSha256: expected.corpusSha256 }, fairness: { configSha256: expected.configSha256, fixedMode: 'balanced', fixedModel: null } }
  assert.doesNotThrow(() => assertComparisonInputs(record, expected))
  for (const changed of [{ corpusSha256: 'c'.repeat(64) }, { configSha256: 'c'.repeat(64) }, { mode: 'deep' }, { model: 'different-model' }]) assert.throws(() => assertComparisonInputs(record, { ...expected, ...changed }), /Comparison inputs/)
  assert.throws(() => assertComparisonInputs({ case: {}, fairness: {} }, expected), /lack fingerprints/)
  assert.throws(() => assertComparisonInputs(record, { ...expected, protocolVersion: 'first-test-v26' }), /Comparison inputs/)
  assert.doesNotThrow(() => assertComparisonInputs({ ...record, fairness: { ...record.fairness, protocolVersion: 'first-test-v26' } }, { ...expected, protocolVersion: 'first-test-v26' }))
})

test('comparison matrix pairs every selected task across providers and lanes', () => {
  const corpus = { repositories: [{ id: 'repo', tasks: [task, { ...task, id: 'task-two' }] }] }
  const matrix = buildComparisonMatrix(corpus)

  assert.equal(matrix.length, 8)
  assert.equal(new Set(matrix.map((entry) => entry.id)).size, 8)
  assert.equal(matrix.filter((entry) => entry.taskId === 'task-one').length, 4)
  assert.throws(() => buildComparisonMatrix(corpus, { taskIds: ['missing'] }), /Unknown comparison task ids/)
})

test('preparation failure preserves zero attempts and unknown model success instead of inventing a failed call', () => {
  const observation = { provider: 'codex', lane: 'bth', attempts: 0, elapsedMs: 10, evidence: { failureCode: 'offline-dependency-cache-incomplete' } }
  const scored = scoreProviderCase(task, observation)
  assert.equal(scored.attempts, 0)
  assert.equal(scored.retries, 0)
  assert.equal(scored.successAt1, null)
  assert.equal(scored.verificationSuccessAt1, null)
  assert.deepEqual(scored.failureReasons, ['provider-not-attempted', 'offline-dependency-cache-incomplete'])
  assert.throws(() => scoreProviderCase(task, { ...observation, providerCompleted: true }), /Zero-attempt/)
  assert.throws(() => scoreProviderCase(task, { ...observation, verificationConfirmed: true }), /Zero-attempt/)
})

test('success at one requires independent task acceptance while historical path coverage remains separate', () => {
  const passed = scoreProviderCase(task, {
    provider: 'codex', lane: 'bth', providerCompleted: true, verificationConfirmed: true,
    attempts: 1, elapsedMs: 100, changedPaths: task.goldPaths, impactPaths: task.goldPaths,
    acceptance: { controlsConfirmed: true, candidatePassed: true },
    ruleViolations: [], usage: { tokens: { input: 10, uncachedInput: 8, output: 5, total: 15 }, costUsd: null }
  })
  assert.equal(passed.successAt1, true)
  assert.equal(passed.changedGoldRecall, 1)

  const incomplete = scoreProviderCase(task, {
    provider: 'codex', lane: 'direct', providerCompleted: true, verificationConfirmed: true,
    attempts: 2, elapsedMs: 120, changedPaths: ['src/a.js'], impactPaths: null,
    acceptance: { controlsConfirmed: true, candidatePassed: true },
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
    acceptance: { controlsConfirmed: true, candidatePassed: true },
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

test('a green existing suite cannot establish task success and missing acceptance is not zero', () => {
  const observation = {
    provider: 'codex', lane: 'bth', providerCompleted: true, verificationConfirmed: true,
    elapsedMs: 100, changedPaths: ['src/a.js']
  }
  const missing = scoreProviderCase(task, observation)
  assert.equal(missing.verificationSuccessAt1, true)
  assert.equal(missing.successAt1, null)
  assert.deepEqual(missing.failureReasons, ['task-acceptance-not-measured'])
  const invalid = scoreProviderCase(task, { ...observation, acceptance: { controlsConfirmed: false, candidatePassed: true } })
  assert.equal(invalid.successAt1, null)
  const failed = scoreProviderCase(task, { ...observation, acceptance: { controlsConfirmed: true, candidatePassed: false } })
  assert.equal(failed.successAt1, false)
  assert.deepEqual(failed.failureReasons, ['task-acceptance-failed'])
  const direct = scoreProviderCase(task, { ...observation, lane: 'direct', acceptance: { controlsConfirmed: true, candidatePassed: true } })
  const [comparison] = compareProviderLanes([missing, direct])
  assert.equal(comparison.bth.successAt1.rate, null)
  assert.equal(comparison.bth.successAt1.measured, 0)
  assert.equal(comparison.delta.successAt1Rate, null)
  const legacy = { ...direct, lane: 'bth', schemaVersion: 2 }
  const [historical] = compareProviderLanes([legacy, direct])
  assert.equal(historical.bth.successAt1.rate, null, 'legacy suite success must never masquerade as task acceptance')
})
