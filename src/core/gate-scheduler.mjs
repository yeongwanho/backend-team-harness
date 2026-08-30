import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function gateSignature(gate) {
  return createHash('sha256').update(canonicalJson({
    id: gate.id,
    required: gate.required,
    dependsOn: gate.dependsOn ?? [],
    parallelSafe: gate.parallelSafe ?? false,
    resourceClass: gate.resourceClass ?? 'project-build',
    network: gate.network ?? false,
    feedback: gate.feedback ?? false,
    pathPrefixes: gate.pathPrefixes ?? [],
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

const EXACT_PRECEDENCE_LIMIT = 18

function greedyReadyOrder(pending, segmentIds) {
  const remaining = [...pending]
  const emitted = new Set()
  const ordered = []
  while (remaining.length > 0) {
    const ready = remaining.filter((entry) => (entry.gate.dependsOn ?? []).every((dependency) => !segmentIds.has(dependency) || emitted.has(dependency)))
    if (ready.length === 0) throw new Error('Verification gate dependencies cannot be scheduled without violating a fixed boundary.')
    ready.sort((left, right) => right.estimate.score - left.estimate.score || left.offset - right.offset)
    const selected = ready[0]
    ordered.push(selected.gate)
    emitted.add(selected.gate.id)
    remaining.splice(remaining.indexOf(selected), 1)
  }
  return ordered
}

function exactPrecedenceOrder(pending, segmentIds) {
  const count = pending.length
  const fullMask = (1 << count) - 1
  const indexById = new Map(pending.map((entry, index) => [entry.gate.id, index]))
  const prerequisites = pending.map((entry) => (entry.gate.dependsOn ?? []).reduce((mask, dependency) => {
    if (!segmentIds.has(dependency)) return mask
    return mask | (1 << indexById.get(dependency))
  }, 0))
  const memo = new Float64Array(1 << count)
  memo.fill(Number.NaN)
  const choice = new Int16Array(1 << count)
  choice.fill(-1)
  memo[fullMask] = 0

  function solve(mask) {
    if (!Number.isNaN(memo[mask])) return memo[mask]
    let best = Number.POSITIVE_INFINITY
    let bestIndex = -1
    for (let index = 0; index < count; index += 1) {
      const bit = 1 << index
      if ((mask & bit) !== 0 || (prerequisites[index] & mask) !== prerequisites[index]) continue
      const estimate = pending[index].estimate
      const expected = estimate.meanDurationMs + (1 - estimate.failureProbability) * solve(mask | bit)
      if (expected < best - 1e-9) {
        best = expected
        bestIndex = index
      }
    }
    if (bestIndex < 0) throw new Error('Verification gate dependencies cannot be scheduled without violating a fixed boundary.')
    memo[mask] = best
    choice[mask] = bestIndex
    return best
  }

  solve(0)
  const ordered = []
  let mask = 0
  while (mask !== fullMask) {
    const index = choice[mask]
    ordered.push(pending[index].gate)
    mask |= 1 << index
  }
  return ordered
}

export function buildGateSchedule(gates, history, scheduling) {
  const original = [...gates]
  const maxParallel = scheduling.maxParallel ?? 1
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
    const segmentIds = new Set(segment.map((gate) => gate.id))
    const pending = segment.map((gate, offset) => ({ gate, offset, estimate: estimates.get(gateSignature(gate)) }))
    const hasInternalDependencies = segment.some((gate) => (gate.dependsOn ?? []).some((dependency) => segmentIds.has(dependency)))
    const exact = sufficient && hasInternalDependencies && segment.length <= EXACT_PRECEDENCE_LIMIT && maxParallel === 1
    const ordered = sufficient
      ? exact
        ? exactPrecedenceOrder(pending, segmentIds)
        : greedyReadyOrder(pending, segmentIds)
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
            ? exact
              ? 'exact_dependency_constrained_dp_expected_failure_feedback'
              : hasInternalDependencies
                ? maxParallel > 1
                  ? 'parallel_dependency_greedy_ready_set'
                  : 'large_dependency_greedy_ready_set'
                : maxParallel > 1
                  ? 'parallel_posterior_failure_probability_per_millisecond'
                  : 'pairwise_optimal_posterior_failure_probability_per_millisecond'
            : 'minimum_observations_not_met'
    })
  }

  const originalIndex = new Map(original.map((gate, index) => [gate, index]))
  const entries = scheduled.map((gate, finalIndex) => {
    const gateEstimate = estimates.get(gateSignature(gate))
    return {
      id: gate.id,
      dependsOn: gate.dependsOn ?? [],
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
      objective: 'reduce_expected_time_to_first_required_failure_without_skipping_gates',
      applied,
      assumptions: ['only-ready-gates-are-reordered', 'gate-failures-are-estimated-as-independent', 'exact-optimality-applies-only-to-sequential-segments-of-at-most-18-gates'],
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
