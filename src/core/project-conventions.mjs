const RULE_STATUSES = new Set(['confirmed', 'unknown', 'conflict'])
const MAX_RULES = 32
const MAX_DOCUMENTS = 32
const MAX_ADJACENT_PATHS = 32

function boundedText(value, maximum = 512) {
  return typeof value === 'string' ? value.slice(0, maximum) : ''
}

function normalizedRuleEvaluation(evaluation) {
  const status = RULE_STATUSES.has(evaluation?.status) ? evaluation.status : 'unknown'
  const sourceResults = Array.isArray(evaluation?.results) ? evaluation.results : []
  const rules = sourceResults.slice(0, MAX_RULES).map((rule) => ({
    id: boundedText(rule?.id, 128),
    description: boundedText(rule?.description, 1024),
    severity: boundedText(rule?.severity, 32),
    status: RULE_STATUSES.has(rule?.status) ? rule.status : 'unknown',
    outcome: boundedText(rule?.outcome, 64),
    source: {
      path: boundedText(rule?.source?.path, 4096),
      section: boundedText(rule?.source?.section, 512)
    }
  }))
  return {
    status,
    readiness: projectRuleReadiness(evaluation),
    blocking: evaluation?.blocking === true,
    counts: {
      confirmed: Number.isSafeInteger(evaluation?.counts?.confirmed) ? evaluation.counts.confirmed : 0,
      unknown: Number.isSafeInteger(evaluation?.counts?.unknown) ? evaluation.counts.unknown : 0,
      conflict: Number.isSafeInteger(evaluation?.counts?.conflict) ? evaluation.counts.conflict : 0
    },
    configuredRuleCount: sourceResults.length,
    omittedRuleCount: Math.max(0, sourceResults.length - rules.length),
    rules
  }
}

function normalizedKnowledge(knowledge) {
  const sourceDocuments = Array.isArray(knowledge?.documents) ? knowledge.documents : []
  const paths = [...new Set(sourceDocuments
    .map((document) => boundedText(document?.path, 4096))
    .filter(Boolean))]
    .slice(0, MAX_DOCUMENTS)
  return {
    complete: knowledge?.complete === true,
    paths,
    omittedPathCount: Math.max(0, sourceDocuments.length - paths.length)
  }
}

function normalizedAdjacentCode(codeContext) {
  const sourceEntries = Array.isArray(codeContext?.entries) ? codeContext.entries : []
  const paths = [...new Set(sourceEntries
    .map((entry) => boundedText(entry?.path, 4096))
    .filter(Boolean))]
    .slice(0, MAX_ADJACENT_PATHS)
  return {
    status: codeContext?.status === 'available' && paths.length > 0 ? 'confirmed' : 'unknown',
    source: codeContext?.status === 'available' ? 'source-bound-codegraph' : 'provider-bounded-discovery-required',
    paths,
    omittedPathCount: Math.max(0, sourceEntries.length - paths.length)
  }
}

export function projectRuleReadiness(evaluation) {
  if (!RULE_STATUSES.has(evaluation?.status)) return 'unknown'
  const results = Array.isArray(evaluation.results) ? evaluation.results : []
  if (results.length === 0) return evaluation.status
  const unresolvedBlockers = results.filter((rule) => rule?.severity === 'blocker' && rule?.status !== 'confirmed')
  if (unresolvedBlockers.some((rule) => rule.status === 'conflict')) return 'conflict'
  if (unresolvedBlockers.length > 0) return 'unknown'
  if (results.some((rule) => rule?.status === 'conflict')) return 'unknown'
  return 'confirmed'
}

export function buildProjectConventions(evaluation, knowledge, codeContext) {
  const projectRules = normalizedRuleEvaluation(evaluation)
  const knowledgeDocuments = normalizedKnowledge(knowledge)
  const adjacentCode = normalizedAdjacentCode(codeContext)
  const status = projectRules.readiness === 'conflict'
    ? 'conflict'
    : projectRules.readiness === 'confirmed' && adjacentCode.status === 'confirmed'
      ? 'confirmed'
      : 'unknown'
  return {
    schemaVersion: 1,
    status,
    projectRules,
    knowledgeDocuments,
    adjacentCode,
    requiredBeforeEdit: {
      readDeclaredRuleSources: true,
      readRelevantKnowledgeDocuments: true,
      inspectAdjacentProductionAndTests: true,
      preserveObservedConventions: true,
      stopOnUnknownOrConflictingBlockingRule: true
    },
    authority: {
      deterministic: true,
      advisoryNavigation: true,
      providerClaimIsEvidence: false,
      verdictAuthority: false
    }
  }
}
