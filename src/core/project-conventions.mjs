const RULE_STATUSES = new Set(['confirmed', 'unknown', 'conflict'])
const MAX_RULES = 32
const MAX_DOCUMENTS = 32
const MAX_ADJACENT_PATHS = 32
const OBSERVATION_STATUSES = new Set(['observed', 'not-observed'])
const DATABASE_SIGNAL_NAMES = [
  'declaredQueries', 'nativeQueries', 'selectStarQueries', 'leadingWildcardLikes',
  'lockingQueries', 'pessimisticLocks', 'indexDeclarations', 'toOneAssociations',
  'defaultEagerToOneAssociations', 'collectionAssociations', 'joinFetches', 'entityGraphs'
]

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

function normalizedDiscoveredConventions(conventions) {
  if (conventions?.status !== 'observed') {
    return {
      status: 'unknown', modules: [], layers: [],
      transactions: { status: 'not-observed', roles: [], examples: [] },
      persistence: { status: 'not-observed', roles: [], examples: [] },
      contracts: {
        routes: { status: 'not-observed', count: 0, methods: [], examples: [] },
        tables: { status: 'not-observed', names: [], examples: [] }
      },
      database: {
        status: 'not-observed', totals: {},
        reviewCandidates: { queryShape: 0, locking: 0, nPlusOne: 0, indexCoverageUnknown: false },
        examples: [],
        authority: { sourcePatternObservationOnly: true, queryPlanExecuted: false, databaseMetadataInspected: false, nPlusOneConfirmed: false }
      },
      tests: { status: 'not-observed', count: 0, pairs: [] },
      limitations: ['No source-bound convention observation was available.']
    }
  }
  const normalizedCitation = (example) => ({
    path: boundedText(example?.path, 4096),
    contentSha256: boundedText(example?.contentSha256, 128),
    declarations: (example?.declarations ?? []).slice(0, 8).map((entry) => boundedText(entry, 256))
  })
  const normalizedObservedGroup = (group, allowedRoles) => ({
    status: OBSERVATION_STATUSES.has(group?.status) ? group.status : 'not-observed',
    roles: [...new Set((group?.roles ?? []).filter((entry) => allowedRoles.has(entry)))].slice(0, 16),
    examples: (group?.examples ?? []).slice(0, 8).map(normalizedCitation)
  })
  return {
    status: 'observed',
    modules: (conventions.modules ?? []).slice(0, 32).map((entry) => boundedText(entry, 4096)),
    layers: (conventions.layers ?? []).slice(0, 16).map((layer) => ({
      role: boundedText(layer.role, 64),
      count: Number.isSafeInteger(layer.count) ? layer.count : 0,
      packages: (layer.packages ?? []).slice(0, 32).map((entry) => boundedText(entry, 512)),
      naming: (layer.naming ?? []).slice(0, 16).map((entry) => ({
        suffix: boundedText(entry.suffix, 128),
        occurrences: Number.isSafeInteger(entry.occurrences) ? entry.occurrences : 0,
        status: entry.status === 'repeated' ? 'repeated' : 'single-example'
      })),
      examples: (layer.examples ?? []).slice(0, 8).map(normalizedCitation)
    })),
    transactions: normalizedObservedGroup(
      conventions.transactions,
      new Set(['controller', 'service', 'repository', 'entity', 'configuration', 'dto', 'error'])
    ),
    persistence: normalizedObservedGroup(conventions.persistence, new Set(['entity', 'repository'])),
    contracts: {
      routes: {
        status: OBSERVATION_STATUSES.has(conventions.contracts?.routes?.status) ? conventions.contracts.routes.status : 'not-observed',
        count: Number.isSafeInteger(conventions.contracts?.routes?.count) ? conventions.contracts.routes.count : 0,
        methods: (conventions.contracts?.routes?.methods ?? []).slice(0, 16).map((entry) => boundedText(entry, 32)),
        examples: (conventions.contracts?.routes?.examples ?? []).slice(0, 8).map((example) => ({
          ...normalizedCitation(example),
          routes: (example?.routes ?? []).slice(0, 16).map((route) => ({
            method: boundedText(route?.method, 32),
            path: boundedText(route?.path, 1024)
          }))
        }))
      },
      tables: {
        status: OBSERVATION_STATUSES.has(conventions.contracts?.tables?.status) ? conventions.contracts.tables.status : 'not-observed',
        names: (conventions.contracts?.tables?.names ?? []).slice(0, 64).map((entry) => boundedText(entry, 256)),
        examples: (conventions.contracts?.tables?.examples ?? []).slice(0, 8).map((example) => ({
          ...normalizedCitation(example),
          tables: (example?.tables ?? []).slice(0, 16).map((entry) => boundedText(entry, 256))
        }))
      }
    },
    database: {
      status: OBSERVATION_STATUSES.has(conventions.database?.status) ? conventions.database.status : 'not-observed',
      totals: Object.fromEntries(DATABASE_SIGNAL_NAMES.map((name) => [
        name,
        Number.isSafeInteger(conventions.database?.totals?.[name]) ? conventions.database.totals[name] : 0
      ])),
      reviewCandidates: {
        queryShape: Number.isSafeInteger(conventions.database?.reviewCandidates?.queryShape) ? conventions.database.reviewCandidates.queryShape : 0,
        locking: Number.isSafeInteger(conventions.database?.reviewCandidates?.locking) ? conventions.database.reviewCandidates.locking : 0,
        nPlusOne: Number.isSafeInteger(conventions.database?.reviewCandidates?.nPlusOne) ? conventions.database.reviewCandidates.nPlusOne : 0,
        indexCoverageUnknown: conventions.database?.reviewCandidates?.indexCoverageUnknown === true
      },
      examples: (conventions.database?.examples ?? []).slice(0, 8).map((example) => ({
        ...normalizedCitation(example),
        signals: Object.fromEntries(DATABASE_SIGNAL_NAMES
          .filter((name) => Number.isSafeInteger(example?.signals?.[name]) && example.signals[name] > 0)
          .map((name) => [name, example.signals[name]]))
      })),
      authority: {
        sourcePatternObservationOnly: true,
        queryPlanExecuted: false,
        databaseMetadataInspected: false,
        nPlusOneConfirmed: false
      }
    },
    tests: {
      status: OBSERVATION_STATUSES.has(conventions.tests?.status) ? conventions.tests.status : 'not-observed',
      count: Number.isSafeInteger(conventions.tests?.count) ? conventions.tests.count : 0,
      pairs: (conventions.tests?.pairs ?? []).slice(0, 32).map((pair) => ({
        production: boundedText(pair?.production, 4096),
        productionSha256: boundedText(pair?.productionSha256, 128),
        test: boundedText(pair?.test, 4096),
        testSha256: boundedText(pair?.testSha256, 128)
      })),
      omittedPairCount: Number.isSafeInteger(conventions.tests?.omittedPairCount) ? conventions.tests.omittedPairCount : 0
    },
    limitations: (conventions.limitations ?? []).slice(0, 8).map((entry) => boundedText(entry, 1024))
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

export function buildProjectConventions(evaluation, knowledge, codeContext, conventions) {
  const projectRules = normalizedRuleEvaluation(evaluation)
  const knowledgeDocuments = normalizedKnowledge(knowledge)
  const adjacentCode = normalizedAdjacentCode(codeContext)
  const discovered = normalizedDiscoveredConventions(conventions)
  const status = projectRules.readiness === 'conflict'
    ? 'conflict'
    : projectRules.readiness === 'confirmed' && adjacentCode.status === 'confirmed' && discovered.status === 'observed'
      ? 'confirmed'
      : 'unknown'
  return {
    schemaVersion: 1,
    status,
    projectRules,
    knowledgeDocuments,
    adjacentCode,
    discovered,
    requiredBeforeEdit: {
      readRelevantDeclaredRuleSources: true,
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
