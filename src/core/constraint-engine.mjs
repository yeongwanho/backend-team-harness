import { canonicalJson } from './canonical-json.mjs'

const FACT_STATUSES = new Set(['confirmed', 'unknown', 'conflict'])

function uniqueSorted(values) {
  return [...new Set(values)].sort()
}

function conditionResult(state, factIds = []) {
  return { state, factIds: uniqueSorted(factIds) }
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

function factCondition(condition, facts) {
  const fact = facts.get(condition.fact)
  if (!fact || fact.status === 'unknown') {
    return conditionResult('unknown', [condition.fact])
  }
  if (fact.status === 'conflict') {
    return conditionResult('conflict', [condition.fact])
  }

  let matches
  if (condition.operator === 'present') {
    matches = fact.value !== null && fact.value !== undefined
  } else if (condition.operator === 'equals') {
    matches = deepEqual(fact.value, condition.value)
  } else if (condition.operator === 'not-equals') {
    matches = !deepEqual(fact.value, condition.value)
  } else if (condition.operator === 'includes') {
    matches = Array.isArray(fact.value) && fact.value.some((entry) => deepEqual(entry, condition.value))
  } else {
    throw new Error('Unsupported condition operator at evaluation: ' + condition.operator)
  }
  return conditionResult(matches ? 'true' : 'false', [condition.fact])
}

function combine(kind, conditions, facts) {
  const results = conditions.map((condition) => evaluateCondition(condition, facts))
  const factIds = results.flatMap((result) => result.factIds)
  if (results.some((result) => result.state === 'conflict')) {
    return conditionResult('conflict', factIds)
  }
  if (kind === 'all') {
    if (results.some((result) => result.state === 'false')) {
      return conditionResult('false', factIds)
    }
    if (results.some((result) => result.state === 'unknown')) {
      return conditionResult('unknown', factIds)
    }
    return conditionResult('true', factIds)
  }
  if (results.some((result) => result.state === 'true')) {
    return conditionResult('true', factIds)
  }
  if (results.some((result) => result.state === 'unknown')) {
    return conditionResult('unknown', factIds)
  }
  return conditionResult('false', factIds)
}

function evaluateCondition(condition, facts) {
  if (Object.hasOwn(condition, 'fact')) {
    return factCondition(condition, facts)
  }
  if (Object.hasOwn(condition, 'all')) {
    return combine('all', condition.all, facts)
  }
  if (Object.hasOwn(condition, 'any')) {
    return combine('any', condition.any, facts)
  }
  const inner = evaluateCondition(condition.not, facts)
  if (inner.state === 'true') {
    return conditionResult('false', inner.factIds)
  }
  if (inner.state === 'false') {
    return conditionResult('true', inner.factIds)
  }
  return inner
}

function factMap(facts) {
  const result = new Map()
  for (const fact of facts) {
    if (!fact || typeof fact.id !== 'string') {
      throw new Error('Every project fact requires an id.')
    }
    if (result.has(fact.id)) {
      throw new Error('Project intelligence contains duplicate fact id ' + fact.id + '.')
    }
    if (!FACT_STATUSES.has(fact.status)) {
      throw new Error('Project fact ' + fact.id + ' has invalid status ' + fact.status + '.')
    }
    result.set(fact.id, fact)
  }
  return result
}

function evaluateRule(rule, facts) {
  if (rule.when) {
    const activation = evaluateCondition(rule.when, facts)
    if (activation.state === 'false') {
      return {
        id: rule.id,
        description: rule.description,
        severity: rule.severity,
        status: 'confirmed',
        outcome: 'not-applicable',
        factIds: activation.factIds,
        source: rule.source
      }
    }
    if (activation.state === 'unknown') {
      return {
        id: rule.id,
        description: rule.description,
        severity: rule.severity,
        status: 'unknown',
        outcome: 'activation-unknown',
        factIds: activation.factIds,
        source: rule.source
      }
    }
    if (activation.state === 'conflict') {
      return {
        id: rule.id,
        description: rule.description,
        severity: rule.severity,
        status: 'conflict',
        outcome: 'input-conflict',
        factIds: activation.factIds,
        source: rule.source
      }
    }
  }

  const assertion = evaluateCondition(rule.assert, facts)
  const common = {
    id: rule.id,
    description: rule.description,
    severity: rule.severity,
    factIds: assertion.factIds,
    source: rule.source
  }
  if (assertion.state === 'true') {
    return { ...common, status: 'confirmed', outcome: 'satisfied' }
  }
  if (assertion.state === 'false') {
    return { ...common, status: 'conflict', outcome: 'violated' }
  }
  if (assertion.state === 'conflict') {
    return { ...common, status: 'conflict', outcome: 'input-conflict' }
  }
  return { ...common, status: 'unknown', outcome: 'insufficient-evidence' }
}

export function evaluateProjectRules(facts, rules) {
  if (!Array.isArray(facts) || !Array.isArray(rules)) {
    throw new Error('Project rule evaluation requires fact and rule arrays.')
  }
  const indexedFacts = factMap(facts)
  const results = rules.map((rule) => evaluateRule(rule, indexedFacts))
  const counts = {
    confirmed: results.filter((result) => result.status === 'confirmed').length,
    unknown: results.filter((result) => result.status === 'unknown').length,
    conflict: results.filter((result) => result.status === 'conflict').length
  }
  return {
    schemaVersion: 1,
    status: counts.conflict > 0 ? 'conflict' : counts.unknown > 0 ? 'unknown' : 'confirmed',
    blocking: results.some((result) =>
      result.severity === 'blocker' &&
      result.status !== 'confirmed' &&
      result.outcome !== 'not-applicable'
    ),
    counts,
    results
  }
}
