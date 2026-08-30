import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGateSchedule,
  expectedFailureFeedbackMs,
  gateSignature
} from '../src/core/gate-scheduler.mjs'

function gate(id, options = {}) {
  return {
    id,
    required: options.required ?? true,
    reorderable: options.reorderable ?? true,
    network: false,
    command: ['./verify-' + id],
    inputs: [],
    timeoutMs: 30_000,
    result: options.result ?? { type: 'junit', reports: ['reports/' + id + '.xml'], minimumTests: 1 }
  }
}

function observation(gateValue, samples, failures, meanDurationMs) {
  return {
    signature: gateSignature(gateValue),
    gateId: gateValue.id,
    samples,
    failures,
    totalDurationMs: samples * meanDurationMs,
    lastObservedAt: '2026-08-30T00:00:00.000Z'
  }
}

const adaptive = Object.freeze({
  strategy: 'adaptive-failure-first',
  minimumObservations: 3,
  priorFailures: 1,
  priorPasses: 1
})

test('configured scheduling and insufficient history preserve declaration order', () => {
  const gates = [gate('slow'), gate('fast')]
  const noOptimization = buildGateSchedule(gates, [], { ...adaptive, strategy: 'configured' })
  const sparse = buildGateSchedule(gates, [
    observation(gates[0], 2, 2, 900),
    observation(gates[1], 2, 0, 20)
  ], adaptive)

  assert.deepEqual(noOptimization.gates.map((entry) => entry.id), ['slow', 'fast'])
  assert.deepEqual(sparse.gates.map((entry) => entry.id), ['slow', 'fast'])
  assert.equal(sparse.decision.applied, false)
  assert.match(sparse.decision.segments[0].reason, /minimum_observations_not_met/)
})

test('adaptive scheduling uses descending Beta-smoothed failure probability per millisecond', () => {
  const gates = [gate('slow-rare'), gate('fast-likely'), gate('medium')]
  const history = [
    observation(gates[0], 10, 1, 1000),
    observation(gates[1], 10, 5, 25),
    observation(gates[2], 10, 2, 100)
  ]

  const scheduled = buildGateSchedule(gates, history, adaptive)

  assert.deepEqual(scheduled.gates.map((entry) => entry.id), ['fast-likely', 'medium', 'slow-rare'])
  assert.equal(scheduled.decision.applied, true)
  assert.equal(scheduled.decision.entries.length, 3)
  assert.ok(scheduled.decision.entries[0].score > scheduled.decision.entries[1].score)
  assert.ok(scheduled.decision.entries[1].score > scheduled.decision.entries[2].score)
})

test('fixed and optional gates are hard boundaries and every gate remains exactly once', () => {
  const gates = [
    gate('a'),
    gate('fixed', { reorderable: false }),
    gate('b'),
    gate('advisory', { required: false, reorderable: false, result: { type: 'observation', reports: ['reports/graph.json'], blockingSeverities: [] } }),
    gate('c'),
    gate('d')
  ]
  const history = gates
    .filter((entry) => entry.reorderable)
    .map((entry, index) => observation(entry, 5, index + 1, 100 - index * 10))

  const scheduled = buildGateSchedule(gates, history, adaptive)

  assert.deepEqual(scheduled.gates.map((entry) => entry.id), ['a', 'fixed', 'b', 'advisory', 'd', 'c'])
  assert.deepEqual([...new Set(scheduled.gates.map((entry) => entry.id))].sort(), gates.map((entry) => entry.id).sort())
})

test('ties are deterministic and keep original order', () => {
  const gates = [gate('first'), gate('second')]
  const history = gates.map((entry) => observation(entry, 5, 1, 100))

  const scheduled = buildGateSchedule(gates, history, adaptive)

  assert.deepEqual(scheduled.gates.map((entry) => entry.id), ['first', 'second'])
  assert.equal(scheduled.decision.applied, false)
})

test('controlled fixture exceeds 2x expected failure-feedback improvement without dropping gates', () => {
  const gates = [gate('slow-pass'), gate('medium-pass'), gate('fast-failure')]
  const history = [
    observation(gates[0], 20, 0, 1000),
    observation(gates[1], 20, 1, 500),
    observation(gates[2], 20, 15, 40)
  ]
  const configured = expectedFailureFeedbackMs(gates, history, adaptive)
  const scheduled = buildGateSchedule(gates, history, adaptive)
  const optimized = expectedFailureFeedbackMs(scheduled.gates, history, adaptive)

  assert.deepEqual(scheduled.gates.map((entry) => entry.id).sort(), gates.map((entry) => entry.id).sort())
  assert.ok(configured / optimized >= 2, { configured, optimized })
})

test('adaptive scheduling optimizes only the ready set and preserves declared dependencies', () => {
  const compile = gate('compile')
  const integration = { ...gate('integration'), dependsOn: ['compile'] }
  const lint = gate('lint')
  const gates = [compile, integration, lint]
  const history = [
    observation(compile, 10, 1, 100),
    observation(integration, 10, 8, 10),
    observation(lint, 10, 5, 20)
  ]

  const scheduled = buildGateSchedule(gates, history, adaptive)

  assert.deepEqual(scheduled.gates.map((entry) => entry.id), ['lint', 'compile', 'integration'])
  assert.ok(scheduled.gates.findIndex((entry) => entry.id === 'compile') < scheduled.gates.findIndex((entry) => entry.id === 'integration'))
  assert.match(scheduled.decision.segments[0].reason, /dependency_constrained/)
})

test('exact precedence DP opens a cheap dependency chain when greedy ready-set scoring is suboptimal', () => {
  const prerequisite = gate('prerequisite')
  const likelyFailure = { ...gate('likely-failure'), dependsOn: ['prerequisite'] }
  const temptingReady = gate('tempting-ready')
  const gates = [prerequisite, likelyFailure, temptingReady]
  const history = [
    observation(prerequisite, 98, 0, 10),
    observation(likelyFailure, 98, 89, 1),
    observation(temptingReady, 98, 9, 5)
  ]

  const scheduled = buildGateSchedule(gates, history, { ...adaptive, maxParallel: 1 })

  assert.deepEqual(scheduled.gates.map((entry) => entry.id), ['prerequisite', 'likely-failure', 'tempting-ready'])
  assert.match(scheduled.decision.segments[0].reason, /exact_dependency_constrained_dp/)
  assert.ok(
    expectedFailureFeedbackMs(scheduled.gates, history, adaptive) <
    expectedFailureFeedbackMs([temptingReady, prerequisite, likelyFailure], history, adaptive)
  )
})
