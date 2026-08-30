const DATABASE_IMPACTS = new Set(['none', 'read', 'write', 'schema'])
const API_IMPACTS = new Set(['none', 'compatible', 'breaking'])
const SCHEMA_STRATEGIES = new Set(['migration', 'bootstrap-only'])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/
const MAX_DECISION_ITEMS = 32

const STOP_WORDS = new Set([
  'add', 'an', 'and', 'api', 'backward', 'compatible', 'create', 'endpoint',
  'for', 'from', 'improve', 'in', 'lookup', 'migration', 'of', 'the', 'to',
  'without', '추가', '개선', '조회', '호환', '하위'
])

function boundedRequirement(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Work requirement must be a non-empty string.')
  }
  const normalized = value.trim()
  if (Buffer.byteLength(normalized, 'utf8') > 128 * 1024) {
    throw new Error('Work requirement exceeds the 131072-byte safety limit.')
  }
  return normalized
}

function boundedIdentifiers(value, label) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_DECISION_ITEMS || value.some((entry) => typeof entry !== 'string' || !IDENTIFIER.test(entry))) {
    throw new Error(label + ' must contain at most ' + MAX_DECISION_ITEMS + ' bounded project identifiers.')
  }
  return [...new Set(value)].sort()
}

function normalizeDecisions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Work decisions must be a JSON object.')
  }
  const allowed = new Set(['modules', 'excludedModules', 'databaseImpact', 'apiImpact', 'schemaStrategy', 'acceptanceCriteria', 'constraints'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error('Unknown work decision: ' + key)
  }
  const modules = boundedIdentifiers(value.modules, 'Work modules')
  const excludedModules = boundedIdentifiers(value.excludedModules, 'Excluded work modules') ?? []
  if (value.databaseImpact !== undefined && !DATABASE_IMPACTS.has(value.databaseImpact)) {
    throw new Error('databaseImpact must be none, read, write, or schema.')
  }
  if (value.apiImpact !== undefined && !API_IMPACTS.has(value.apiImpact)) {
    throw new Error('apiImpact must be none, compatible, or breaking.')
  }
  if (value.schemaStrategy !== undefined && !SCHEMA_STRATEGIES.has(value.schemaStrategy)) {
    throw new Error('schemaStrategy must be migration or bootstrap-only.')
  }
  const acceptanceCriteria = value.acceptanceCriteria === undefined
    ? undefined
    : boundedRequirement(value.acceptanceCriteria)
  const constraints = value.constraints === undefined
    ? undefined
    : boundedRequirement(value.constraints)
  return {
    modules,
    excludedModules,
    databaseImpact: value.databaseImpact,
    schemaStrategy: value.schemaStrategy,
    apiImpact: value.apiImpact,
    acceptanceCriteria,
    constraints
  }
}

function tokens(value) {
  return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
    .filter((token) => !STOP_WORDS.has(token)))]
}

function moduleForPath(path) {
  const normalized = String(path ?? '').replaceAll('\\', '/')
  const marker = normalized.indexOf('/src/')
  return marker < 0 ? 'root' : marker === 0 ? 'root' : normalized.slice(0, marker)
}

function searchableFile(entry) {
  return [
    entry?.path,
    entry?.packageName,
    ...(entry?.declarations ?? []).flatMap((declaration) => [declaration?.name, declaration?.qualifiedName]),
    ...(entry?.routes ?? []).map((route) => route?.path)
  ].filter(Boolean).join(' ').toLowerCase()
}

function inferModule(requirement, files) {
  const modules = [...new Set(files.map((entry) => moduleForPath(entry.path)))].sort()
  if (modules.length === 1) {
    return { modules, basis: 'single-observed-source-module', adjacentPaths: files.slice(0, 8).map((entry) => entry.path) }
  }
  const terms = tokens(requirement)
  const scoredFiles = files.map((entry) => {
    const haystack = searchableFile(entry)
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0)
    return { entry, module: moduleForPath(entry.path), score }
  }).filter((candidate) => candidate.score > 0)
  const scores = new Map()
  for (const candidate of scoredFiles) {
    scores.set(candidate.module, (scores.get(candidate.module) ?? 0) + candidate.score)
  }
  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) {
    return { modules: null, basis: 'ambiguous-source-module', adjacentPaths: [] }
  }
  const selected = ranked[0][0]
  return {
    modules: [selected],
    basis: 'requirement-to-source-lexical-match',
    adjacentPaths: scoredFiles
      .filter((candidate) => candidate.module === selected)
      .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
      .slice(0, 8)
      .map((candidate) => candidate.entry.path)
  }
}

function inferDatabaseImpact(requirement) {
  const text = requirement.toLowerCase()
  if (/(no|without) (database|db|stored-data|data) (change|impact)|db 변경 없음|데이터(?:베이스)? (?:변경|영향) 없음/.test(text)) return 'none'
  const explicitlyNoMigration = /(no|without) (?:a )?migration|migration 없음|마이그레이션 없음/.test(text)
  if (!explicitlyNoMigration && /(migration|schema|column|table|index|flyway|마이그레이션|스키마|컬럼|테이블|인덱스)/.test(text)) return 'schema'
  if (/(persist|save|insert|delete|update (?:a |the )?(?:row|record|entity)|backfill|저장|삭제|데이터 수정|값 변경)/.test(text)) return 'write'
  if (/(lookup|fetch|read|search|find|list|get |query|조회|검색|목록)/.test(text)) return 'read'
  return null
}

function inferApiImpact(requirement) {
  const text = requirement.toLowerCase()
  if (/(breaking|incompatible|remove|rename).*(api|endpoint|contract)|(api|endpoint|contract).*(breaking|incompatible|remove|rename)|호환.*깨|기존 api.*변경/.test(text)) return 'breaking'
  if (/(internal only|no (?:public )?api (?:change|impact)|api 변경 없음|내부 구현만)/.test(text)) return 'none'
  const mentionsApi = /(api|endpoint|route|controller|contract|엔드포인트|라우트|컨트롤러)/.test(text)
  if (mentionsApi && /(compatible|backward|add|create|new|호환|추가|신규)/.test(text)) return 'compatible'
  return null
}

function requiredGates(context) {
  return [...new Set((context?.verification?.gates ?? [])
    .filter((gate) => gate?.required === true && typeof gate.id === 'string')
    .map((gate) => gate.id))].sort()
}

function activeBlockers(context) {
  return (context?.intelligence?.evaluation?.results ?? [])
    .filter((rule) => rule?.severity === 'blocker' && rule?.status !== 'confirmed' && rule?.outcome !== 'not-applicable')
    .map((rule) => ({ id: rule.id, status: rule.status, outcome: rule.outcome, source: rule.source }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function question(id, prompt, choices = null) {
  return { id, prompt, choices, authority: 'human-decision-required' }
}

export function deriveWorkDraft(input) {
  const requirement = boundedRequirement(input?.requirement)
  const context = input?.context ?? {}
  const decisions = normalizeDecisions(input?.decisions)
  const blockers = activeBlockers(context)
  const codeFiles = Array.isArray(context?.intelligence?.code?.files) ? context.intelligence.code.files : []
  const moduleInference = decisions.modules
    ? { modules: decisions.modules, basis: 'explicit-human-decision', adjacentPaths: [] }
    : inferModule(requirement, codeFiles)
  const databaseImpact = decisions.databaseImpact ?? inferDatabaseImpact(requirement)
  const apiImpact = decisions.apiImpact ?? inferApiImpact(requirement)
  if (decisions.schemaStrategy !== undefined && databaseImpact !== null && databaseImpact !== 'schema') {
    throw new Error('schemaStrategy is valid only for schema database impact.')
  }
  const migrationFact = context.intelligence?.facts?.find((fact) => fact.id === 'database.migration.present') ??
    context.intelligence?.facts?.find((fact) => fact.id === 'database.flyway.present')
  const migrationObserved = migrationFact?.status === 'confirmed' && migrationFact.value === true
  const schemaStrategy = databaseImpact === 'schema' ? decisions.schemaStrategy ?? (migrationObserved ? 'migration' : null) : null
  const questions = []
  if (!moduleInference.modules?.length) {
    questions.push(question('scope.modules', 'Which project modules or source prefixes may change?'))
  }
  if (!databaseImpact) {
    questions.push(question('data.impact', 'What database impact is allowed?', ['none', 'read', 'write', 'schema']))
  }
  if (databaseImpact === 'schema' && !schemaStrategy) {
    questions.push(question('data.schema-strategy', 'Is this an upgrade of existing databases, or initialization of new empty databases only?', ['migration', 'bootstrap-only']))
  }
  if (!apiImpact) {
    questions.push(question('api.impact', 'What public API compatibility boundary applies?', ['none', 'compatible', 'breaking']))
  }
  const changesPublicApi = apiImpact === null ? null : apiImpact !== 'none'
  const preservesCompatibility = apiImpact === null ? null : apiImpact !== 'breaking'
  const requiresMigration = databaseImpact === null || (databaseImpact === 'schema' && !schemaStrategy) ? null : databaseImpact === 'schema' && schemaStrategy === 'migration'
  const changesDatabase = databaseImpact === null ? null : ['write', 'schema'].includes(databaseImpact)
  const draft = {
    requirement,
    acceptanceCriteria: decisions.acceptanceCriteria ?? 'The requested behavior is observable and verified: ' + requirement,
    modules: moduleInference.modules,
    excludedModules: decisions.excludedModules,
    databaseImpact,
    schemaStrategy,
    changesDatabase,
    requiresMigration,
    apiImpact,
    changesPublicApi,
    preservesCompatibility,
    requiredGates: requiredGates(context),
    constraints: decisions.constraints ?? 'Preserve observed project conventions and do not widen the approved scope.'
  }
  return {
    schemaVersion: 1,
    status: blockers.length ? 'blocked' : questions.length ? 'needs-decisions' : 'ready-for-plan-review',
    sourceFingerprint: context?.sourceBinding?.fingerprint ?? context?.intelligence?.sourceFingerprint ?? null,
    draft,
    questions: blockers.length ? [] : questions,
    blockers,
    evidence: {
      moduleInference: moduleInference.basis,
      adjacentPaths: moduleInference.adjacentPaths,
      projectRuleStatus: context?.intelligence?.evaluation?.status ?? 'unknown',
      verificationStatus: context?.verification?.status ?? 'missing'
    },
    authority: {
      deterministic: true,
      advisoryInference: true,
      humanApprovalRequired: true,
      inferenceCreatesVerdict: false
    }
  }
}
