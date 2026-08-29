#!/usr/bin/env node

import { buildGateSchedule, expectedFailureFeedbackMs, gateSignature } from '../src/core/gate-scheduler.mjs'

function gate(id, durationMs, failures) {
  const value = {
    id,
    required: true,
    reorderable: true,
    network: false,
    command: ['./benchmark-' + id],
    inputs: [],
    timeoutMs: 30_000,
    result: { type: 'junit', reports: ['reports/' + id + '.xml'], minimumTests: 1 }
  }
  return {
    gate: value,
    history: {
      signature: gateSignature(value),
      gateId: id,
      samples: 20,
      failures,
      totalDurationMs: 20 * durationMs,
      lastObservedAt: '2026-08-30T00:00:00.000Z'
    }
  }
}

const fixtures = [
  gate('slow-low-risk', 1200, 0),
  gate('medium-risk', 500, 1),
  gate('fast-high-risk', 40, 15)
]
const gates = fixtures.map((entry) => entry.gate)
const history = fixtures.map((entry) => entry.history)
const scheduling = {
  strategy: 'adaptive-failure-first',
  minimumObservations: 3,
  priorFailures: 1,
  priorPasses: 1
}
const scheduled = buildGateSchedule(gates, history, scheduling)
const configuredMs = expectedFailureFeedbackMs(gates, history, scheduling)
const adaptiveMs = expectedFailureFeedbackMs(scheduled.gates, history, scheduling)
const speedup = configuredMs / adaptiveMs
const identityPreserved = gates.length === scheduled.gates.length &&
  gates.map((entry) => entry.id).sort().join('\0') === scheduled.gates.map((entry) => entry.id).sort().join('\0')

const result = {
  schemaVersion: 1,
  benchmark: 'independent-fail-fast-gate-ordering',
  model: 'E[T] = sum(c_i * product(1-p_j for j before i))',
  assumptions: scheduled.decision.assumptions,
  configuredOrder: gates.map((entry) => entry.id),
  adaptiveOrder: scheduled.gates.map((entry) => entry.id),
  configuredExpectedFeedbackMs: configuredMs,
  adaptiveExpectedFeedbackMs: adaptiveMs,
  speedup,
  identityPreserved,
  requiredGateCount: gates.length,
  adaptiveGateCount: scheduled.gates.length,
  threshold: 2
}

console.log(JSON.stringify(result, null, 2))
if (!identityPreserved || speedup < 2) {
  process.exitCode = 1
}
