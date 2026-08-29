import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function gateSignature(gate) {
  return createHash('sha256').update(canonicalJson({
    id: gate.id,
    required: gate.required,
    network: gate.network ?? false,
    command: gate.command,
    inputs: gate.inputs ?? [],
    timeoutMs: gate.timeoutMs,
    result: gate.result
  })).digest('hex')
}

function historyBySignature(history) {
  return new Map((Array.isArray(history) ? history : []).map((entry) => [entry.signature, entry]))
}

function estimate(gate, historyMap, scheduling) {
  const signature = gateSignature(gate)
  const observed = historyMap.get(signature)
  const samples = Number.isSafeInteger(observed?.samples) ? observed.samples : 0
  const failures = Number.isSafeInteger(observed?.failures) ? observed.failures : 0
  const totalDurationMs = finiteNonNegative(observed?.totalDurationMs)
  const meanDurationMs = samples > 0 ? Math.max(1, totalDurationMs / samples) : null
  const failureProbability = (
    failures + scheduling.priorFailures
  ) / (
    samples + scheduling.priorFailures + scheduling.priorPasses
  )
  return {
    signature,
    samples,
    failures,
    meanDurationMs,
    failureProbability,
    score: meanDurationMs === null ? null : failureProbability / meanDurationMs
  }
}

function eligible(gate) {
  return gate.required === true && gate.reorderable === true
}

export function buildGateSchedule(gates, history, scheduling) {
  const original = [...gates]
  const historyMap = historyBySignature(history)
  const estimates = new Map(original.map((gate) => [gateSignature(gate), estimate(gate, historyMap, scheduling)]))
  const scheduled = []
  const segments = []

  for (let index = 0; index < original.length;) {
    if (!eligible(original[index])) {
      scheduled.push(original[index])
      index += 1
      continue
    }
    const start = index
    const segment = []
    while (index < original.length && eligible(original[index])) {
      segment.push(original[index])
      index += 1
    }
    const sufficient = scheduling.strategy === 'adaptive-failure-first' && segment.length > 1 &&
      segment.every((gate) => estimates.get(gateSignature(gate)).samples >= scheduling.minimumObservations)
    const ordered = sufficient
      ? segment
          .map((gate, offset) => ({ gate, offset, estimate: estimates.get(gateSignature(gate)) }))
          .sort((left, right) => right.estimate.score - left.estimate.score || left.offset - right.offset)
          .map((entry) => entry.gate)
      : segment
    scheduled.push(...ordered)
    segments.push({
      start,
      length: segment.length,
      applied: ordered.some((gate, offset) => gate !== segment[offset]),
      reason: scheduling.strategy !== 'adaptive-failure-first'
        ? 'configured_strategy'
        : segment.length < 2
          ? 'single_gate_segment'
          : sufficient
            ? 'posterior_failure_probability_per_millisecond'
            : 'minimum_observations_not_met'
    })
  }

  const originalIndex = new Map(original.map((gate, index) => [gate, index]))
  const entries = scheduled.map((gate, finalIndex) => {
    const gateEstimate = estimates.get(gateSignature(gate))
    return {
      id: gate.id,
      signature: gateEstimate.signature,
      originalIndex: originalIndex.get(gate),
      finalIndex,
      eligible: eligible(gate),
      samples: gateEstimate.samples,
      failures: gateEstimate.failures,
      meanDurationMs: gateEstimate.meanDurationMs,
      failureProbability: gateEstimate.failureProbability,
      score: gateEstimate.score
    }
  })
  const applied = entries.some((entry) => entry.originalIndex !== entry.finalIndex)
  return {
    gates: scheduled,
    decision: {
      schemaVersion: 1,
      strategy: scheduling.strategy,
      objective: 'minimize_expected_time_to_first_required_failure_without_skipping_gates',
      applied,
      assumptions: ['eligible-gates-are-order-independent', 'gate-failures-are-estimated-as-independent'],
      minimumObservations: scheduling.minimumObservations,
      prior: { failures: scheduling.priorFailures, passes: scheduling.priorPasses },
      originalOrder: original.map((gate) => gate.id),
      selectedOrder: scheduled.map((gate) => gate.id),
      segments,
      entries
    }
  }
}

export function expectedFailureFeedbackMs(gates, history, scheduling) {
  const historyMap = historyBySignature(history)
  let reachProbability = 1
  let expectedMs = 0
  for (const gate of gates) {
    const gateEstimate = estimate(gate, historyMap, scheduling)
    const duration = gateEstimate.meanDurationMs ?? gate.timeoutMs
    expectedMs += reachProbability * duration
    reachProbability *= 1 - gateEstimate.failureProbability
  }
  return expectedMs
}
