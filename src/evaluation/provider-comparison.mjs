import { aggregateLocalization, scoreLocalization } from './metrics.mjs'

export const COMPARISON_LANES = Object.freeze(['bth', 'direct'])
export const COMPARISON_PROVIDERS = Object.freeze(['codex', 'claude'])

function finiteNonNegative(value, label, nullable = false) {
  if (nullable && value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(label + ' must be a finite non-negative number.')
  return value
}

function uniquePaths(value, label) {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error(label + ' must contain at most 10000 paths.')
  const result = []
  const seen = new Set()
  for (const [index, path] of value.entries()) {
    if (typeof path !== 'string' || !path || path.length > 4096 || path.includes('\0') || path.startsWith('/') || path.includes('..')) {
      throw new Error(label + '[' + index + '] is not a safe repository-relative path.')
    }
    const normalized = path.replaceAll('\\', '/')
    if (!seen.has(normalized)) {
      result.push(normalized)
      seen.add(normalized)
    }
  }
  return result
}

function usage(value, provider) {
  const input = value ?? {}
  const tokens = input.tokens ?? {}
  const normalized = {
    input: finiteNonNegative(tokens.input ?? null, 'usage.tokens.input', true),
    uncachedInput: finiteNonNegative(tokens.uncachedInput ?? null, 'usage.tokens.uncachedInput', true),
    output: finiteNonNegative(tokens.output ?? null, 'usage.tokens.output', true),
    cachedInput: finiteNonNegative(tokens.cachedInput ?? null, 'usage.tokens.cachedInput', true),
    cacheCreationInput: finiteNonNegative(tokens.cacheCreationInput ?? null, 'usage.tokens.cacheCreationInput', true),
    reasoningOutput: finiteNonNegative(tokens.reasoningOutput ?? null, 'usage.tokens.reasoningOutput', true),
    total: finiteNonNegative(tokens.total ?? null, 'usage.tokens.total', true)
  }
  return {
    provider,
    tokens: normalized,
    costUsd: finiteNonNegative(input.costUsd ?? null, 'usage.costUsd', true),
    durationMs: finiteNonNegative(input.durationMs ?? null, 'usage.durationMs', true),
    turns: finiteNonNegative(input.turns ?? null, 'usage.turns', true)
  }
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function sumMeasured(values) {
  const measured = values.filter((value) => value !== null)
  return { value: measured.length ? measured.reduce((sum, value) => sum + value, 0) : null, measured: measured.length, total: values.length }
}

export function comparisonCaseId(provider, lane, taskId) {
  if (!COMPARISON_PROVIDERS.includes(provider)) throw new Error('Unknown comparison provider: ' + provider)
  if (!COMPARISON_LANES.includes(lane)) throw new Error('Unknown comparison lane: ' + lane)
  if (typeof taskId !== 'string' || !taskId) throw new Error('Comparison task id is required.')
  return provider + ':' + lane + ':' + taskId
}

export function assertComparisonInputs(record, expected) {
  if (typeof expected.corpusSha256 !== 'string' || typeof expected.configSha256 !== 'string' ||
    record.case?.corpusSha256 !== expected.corpusSha256 ||
    record.fairness?.configSha256 !== expected.configSha256 ||
    record.fairness?.fixedMode !== expected.mode ||
    (record.fairness?.fixedModel ?? null) !== (expected.model ?? null) ||
    (expected.protocolVersion !== undefined && record.fairness?.protocolVersion !== expected.protocolVersion)) {
    throw new Error('Comparison inputs differ or lack fingerprints; use a fresh output directory instead of mixing results.')
  }
}

export function buildComparisonMatrix(corpus, options = {}) {
  const providers = options.providers ?? COMPARISON_PROVIDERS
  const lanes = options.lanes ?? COMPARISON_LANES
  const taskFilter = options.taskIds ? new Set(options.taskIds) : null
  const cases = []
  for (const provider of providers) {
    if (!COMPARISON_PROVIDERS.includes(provider)) throw new Error('Unknown comparison provider: ' + provider)
    for (const lane of lanes) {
      if (!COMPARISON_LANES.includes(lane)) throw new Error('Unknown comparison lane: ' + lane)
      for (const repository of corpus.repositories) {
        for (const task of repository.tasks) {
          if (taskFilter && !taskFilter.has(task.id)) continue
          cases.push({
            id: comparisonCaseId(provider, lane, task.id),
            provider,
            lane,
            repositoryId: repository.id,
            taskId: task.id,
            corpusSha256: corpus.sourceSha256 ?? null,
            requirementSha256: task.requirementSha256 ?? null,
            baseSha: task.baseSha,
            targetSha: task.targetSha
          })
        }
      }
    }
  }
  if (taskFilter) {
    const found = new Set(cases.map((entry) => entry.taskId))
    const missing = [...taskFilter].filter((id) => !found.has(id))
    if (missing.length) throw new Error('Unknown comparison task ids: ' + missing.join(', '))
  }
  return cases
}

export function scoreProviderCase(task, observation) {
  const provider = observation?.provider
  const lane = observation?.lane
  const id = comparisonCaseId(provider, lane, task.id)
  const changedPaths = uniquePaths(observation.changedPaths ?? [], 'changedPaths')
  const impactPaths = observation.impactPaths === null || observation.impactPaths === undefined
    ? null
    : uniquePaths(observation.impactPaths, 'impactPaths')
  const violations = Array.isArray(observation.ruleViolations) ? observation.ruleViolations.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 1024) throw new Error('ruleViolations[' + index + '] is invalid.')
    return entry.trim()
  }) : []
  const providerCompleted = observation.providerCompleted === true
  const verificationConfirmed = observation.verificationConfirmed === true
  const gold = new Set(task.goldPaths)
  const goldPathsChanged = task.goldPaths.filter((path) => changedPaths.includes(path))
  const changedGoldRecall = gold.size ? goldPathsChanged.length / gold.size : 0
  const unexpectedChangedPaths = changedPaths.filter((path) => !gold.has(path))
  const impactLocalization = impactPaths === null ? null : scoreLocalization(task, impactPaths)
  const outcomeLocalization = scoreLocalization(task, changedPaths)
  const attempts = observation.attempts ?? 1
  if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts > 100) throw new Error('attempts must be an integer between 0 and 100.')
  if (attempts === 0 && (providerCompleted || verificationConfirmed)) throw new Error('Zero-attempt observation cannot claim completed implementation or verification.')
  const elapsedMs = finiteNonNegative(observation.elapsedMs, 'elapsedMs')
  const normalizedUsage = usage(observation.usage, provider)
  const failureReasons = []
  if (!providerCompleted) failureReasons.push('provider-did-not-complete')
  if (!verificationConfirmed) failureReasons.push('structured-verification-not-confirmed')
  if (changedPaths.length === 0) failureReasons.push('no-source-change')
  if (attempts > 1) failureReasons.push('required-retry')
  if (violations.length) failureReasons.push('rule-violation')
  const verificationSuccessAt1 = attempts === 0 ? null : failureReasons.length === 0
  const acceptanceConfirmed = observation.acceptance?.controlsConfirmed === true && typeof observation.acceptance?.candidatePassed === 'boolean'
    ? observation.acceptance.candidatePassed
    : null
  if (acceptanceConfirmed === null) failureReasons.push('task-acceptance-not-measured')
  else if (!acceptanceConfirmed) failureReasons.push('task-acceptance-failed')
  return {
    schemaVersion: 3,
    id,
    provider,
    lane,
    taskId: task.id,
    successAt1: attempts === 0 ? null : verificationSuccessAt1 ? acceptanceConfirmed : false,
    verificationSuccessAt1,
    acceptanceConfirmed,
    failureReasons: attempts === 0 ? ['provider-not-attempted', observation.evidence?.failureCode ?? 'implementation-not-started'] : failureReasons,
    providerCompleted,
    verificationConfirmed,
    attempts,
    retries: Math.max(0, attempts - 1),
    elapsedMs,
    usage: normalizedUsage,
    changedPaths,
    goldPathsChanged,
    unexpectedChangedPaths,
    changedGoldRecall,
    ruleViolations: violations,
    impactLocalization,
    outcomeLocalization
  }
}

function aggregateMeasuredLocalization(cases, field) {
  const measured = cases.map((entry) => entry[field]).filter(Boolean)
  return {
    coverage: { measured: measured.length, total: cases.length, rate: cases.length ? measured.length / cases.length : null },
    metrics: measured.length ? aggregateLocalization(measured) : null
  }
}

export function aggregateProviderCases(cases) {
  const impactLocalization = aggregateMeasuredLocalization(cases, 'impactLocalization')
  const outcomeLocalization = aggregateMeasuredLocalization(cases, 'outcomeLocalization')
  // Schema 2's successAt1 measured only existing-suite verification. It cannot
  // acquire a stronger meaning merely because a newer reporter reads it.
  const measuredSuccess = cases.filter((entry) => entry.schemaVersion >= 3 && typeof entry.successAt1 === 'boolean')
  const successCount = measuredSuccess.filter((entry) => entry.successAt1).length
  const retryCases = cases.filter((entry) => entry.retries > 0).length
  return {
    cases: cases.length,
    successAt1: {
      count: successCount,
      measured: measuredSuccess.length,
      total: cases.length,
      rate: cases.length && measuredSuccess.length === cases.length ? successCount / cases.length : null,
      observedRate: measuredSuccess.length ? successCount / measuredSuccess.length : null
    },
    verificationSuccessAt1: {
      count: cases.filter((entry) => entry.schemaVersion >= 3 ? entry.verificationSuccessAt1 : entry.successAt1).length,
      total: cases.length
    },
    acceptanceCoverage: { measured: cases.filter((entry) => entry.schemaVersion >= 3 && typeof entry.acceptanceConfirmed === 'boolean').length, total: cases.length },
    ruleViolations: {
      cases: cases.filter((entry) => entry.ruleViolations.length > 0).length,
      total: cases.reduce((sum, entry) => sum + entry.ruleViolations.length, 0)
    },
    impactLocalization,
    outcomeLocalization,
    elapsedMs: { mean: mean(cases.map((entry) => entry.elapsedMs)), total: cases.reduce((sum, entry) => sum + entry.elapsedMs, 0) },
    retries: {
      cases: retryCases,
      rate: cases.length ? retryCases / cases.length : null,
      total: cases.reduce((sum, entry) => sum + entry.retries, 0)
    },
    usage: {
      tokens: Object.fromEntries(['total', 'input', 'uncachedInput', 'cachedInput', 'cacheCreationInput', 'output', 'reasoningOutput']
        .map((field) => [field, sumMeasured(cases.map((entry) => entry.usage.tokens[field]))])),
      costUsd: sumMeasured(cases.map((entry) => entry.usage.costUsd)),
      providerDurationMs: sumMeasured(cases.map((entry) => entry.usage.durationMs))
    }
  }
}

export function compareProviderLanes(cases) {
  const result = []
  for (const provider of COMPARISON_PROVIDERS) {
    const providerCases = cases.filter((entry) => entry.provider === provider)
    if (!providerCases.length) continue
    const bth = providerCases.filter((entry) => entry.lane === 'bth')
    const direct = providerCases.filter((entry) => entry.lane === 'direct')
    const pairedTaskIds = [...new Set(bth.map((entry) => entry.taskId))]
      .filter((taskId) => direct.some((entry) => entry.taskId === taskId)).sort()
    const pairedBth = bth.filter((entry) => pairedTaskIds.includes(entry.taskId))
    const pairedDirect = direct.filter((entry) => pairedTaskIds.includes(entry.taskId))
    const bthAggregate = aggregateProviderCases(pairedBth)
    const directAggregate = aggregateProviderCases(pairedDirect)
    result.push({
      provider,
      pairedTasks: pairedTaskIds.length,
      taskIds: pairedTaskIds,
      bth: bthAggregate,
      direct: directAggregate,
      delta: {
        successAt1Rate: bthAggregate.successAt1.rate !== null && directAggregate.successAt1.rate !== null
          ? bthAggregate.successAt1.rate - directAggregate.successAt1.rate : null,
        ruleViolationCases: bthAggregate.ruleViolations.cases - directAggregate.ruleViolations.cases,
        meanImpactRecallAt20: bthAggregate.impactLocalization.metrics && directAggregate.impactLocalization.metrics
          ? bthAggregate.impactLocalization.metrics.meanRecallAt20 - directAggregate.impactLocalization.metrics.meanRecallAt20
          : null,
        meanImpactNdcgAt20: bthAggregate.impactLocalization.metrics && directAggregate.impactLocalization.metrics
          ? bthAggregate.impactLocalization.metrics.meanNdcgAt20 - directAggregate.impactLocalization.metrics.meanNdcgAt20
          : null,
        meanOutcomeRecallAt20: pairedTaskIds.length
          ? bthAggregate.outcomeLocalization.metrics.meanRecallAt20 - directAggregate.outcomeLocalization.metrics.meanRecallAt20
          : null,
        meanElapsedMs: pairedTaskIds.length ? bthAggregate.elapsedMs.mean - directAggregate.elapsedMs.mean : null
      }
    })
  }
  return result
}
