import { createHash } from 'node:crypto'
import { canonicalJson } from './canonical-json.mjs'
import { assertTaskId, normalizeTaskText } from './task-state.mjs'

export const INTERVIEW_SCHEMA_VERSION = 1

export const INTERVIEW_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'acceptance',
    title: '완료 조건',
    prompt: '이 작업이 완료됐다고 판단할 수 있는 관찰 가능한 결과를 적어 주세요.',
    hint: 'API 응답, 저장 결과, 실패 동작처럼 테스트로 확인할 수 있는 문장으로 적습니다.'
  }),
  Object.freeze({
    id: 'scope',
    title: '변경 범위',
    prompt: '변경을 허용할 모듈·경로·외부 계약과 건드리면 안 되는 범위를 적어 주세요.',
    hint: '아직 경로를 모르면 기능 경계와 제외 대상을 적고 status를 unknown으로 남깁니다.'
  }),
  Object.freeze({
    id: 'data',
    title: 'DB와 데이터 영향',
    prompt: '스키마·migration·기존 데이터·트랜잭션·동시성 영향과 호환 조건을 적어 주세요.',
    hint: '영향이 없으면 "없음"이라고 명시합니다. 미확정이면 status를 unknown으로 남깁니다.'
  }),
  Object.freeze({
    id: 'verification',
    title: '검증 방법',
    prompt: '반드시 통과해야 할 테스트, 실패 시나리오, 재현 방법을 적어 주세요.',
    hint: 'BTH가 발견한 Gate는 계획에 자동 첨부되며, 여기에는 업무별 추가 검증을 적습니다.'
  }),
  Object.freeze({
    id: 'constraints',
    title: '제약과 제외',
    prompt: '보안·성능·호환성 제약, 하지 않을 일, 승인 전 남겨 둘 위험을 적어 주세요.',
    hint: '특별한 제약이 없으면 "없음"이라고 명시합니다.'
  })
])

const ANSWER_STATUSES = new Set(['answered', 'unknown', 'conflict'])
const CLAIM_KEYS_BY_QUESTION = Object.freeze({
  acceptance: new Set(),
  scope: new Set(['changesPublicApi', 'modules', 'excludedModules']),
  data: new Set(['changesDatabase', 'requiresMigration', 'bootstrapOnly']),
  verification: new Set(['requiredGates']),
  constraints: new Set(['preservesCompatibility'])
})
const BOOLEAN_CLAIMS = new Set(['changesPublicApi', 'changesDatabase', 'requiresMigration', 'bootstrapOnly', 'preservesCompatibility'])
const ARRAY_CLAIMS = new Set(['modules', 'excludedModules', 'requiredGates'])
const CLAIM_VALUE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function answerMap(answers = []) {
  return new Map(answers.map((answer) => [answer.questionId, answer]))
}

function normalizeClaims(questionId, value, previous = {}) {
  if (value === undefined) return previous
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Interview claims must be a JSON object.')
  }
  const allowed = CLAIM_KEYS_BY_QUESTION[questionId]
  const result = {}
  for (const [key, claim] of Object.entries(value)) {
    if (!allowed?.has(key)) throw new Error('Interview question ' + questionId + ' does not support claim ' + key + '.')
    if (BOOLEAN_CLAIMS.has(key)) {
      if (typeof claim !== 'boolean') throw new Error('Interview claim ' + key + ' must be boolean.')
      result[key] = claim
      continue
    }
    if (!ARRAY_CLAIMS.has(key) || !Array.isArray(claim) || claim.length > 32 || claim.some((entry) => typeof entry !== 'string' || !CLAIM_VALUE.test(entry))) {
      throw new Error('Interview claim ' + key + ' must contain at most 32 bounded identifiers.')
    }
    result[key] = [...new Set(claim)].sort()
  }
  return result
}

function contradiction(id, summary, questionIds, factIds = [], details = {}) {
  const body = {
    id,
    summary,
    questionIds: [...new Set(questionIds)].sort(),
    factIds: [...new Set(factIds)].sort(),
    details
  }
  return {
    ...body,
    candidateSha256: digest(body),
    authority: 'advisory-human-resolution-required',
    verdictAuthority: false
  }
}

function factFrom(contextSnapshot, id) {
  return contextSnapshot?.intelligence?.facts?.find((entry) => entry.id === id) ?? null
}

export function deriveInterviewContradictions(record, contextSnapshot = null) {
  const answers = answerMap(record.answers)
  const scope = answers.get('scope')?.claims ?? {}
  const data = answers.get('data')?.claims ?? {}
  const verification = answers.get('verification')?.claims ?? {}
  const constraints = answers.get('constraints')?.claims ?? {}
  const candidates = []
  if (data.bootstrapOnly === true && (data.requiresMigration === true || data.changesDatabase !== true)) {
    candidates.push(contradiction('bootstrap-with-incompatible-data-claims',
      'Bootstrap-only changes require declared database impact and cannot also claim an existing-database migration.',
      ['data'], [], { bootstrapOnly: true, requiresMigration: data.requiresMigration ?? null, changesDatabase: data.changesDatabase ?? null }))
  }

  if (data.changesDatabase === false && data.requiresMigration === true) {
    candidates.push(contradiction(
      'database-migration-without-database-change',
      'A migration is required while the same answer declares no database change.',
      ['data'],
      [],
      { changesDatabase: false, requiresMigration: true }
    ))
  }

  const overlappingModules = (scope.modules ?? []).filter((module) => (scope.excludedModules ?? []).includes(module))
  if (overlappingModules.length > 0) {
    candidates.push(contradiction(
      'scope-includes-excluded-module',
      'The approved scope both includes and excludes the same module.',
      ['scope'],
      [],
      { modules: overlappingModules }
    ))
  }

  const configuredGates = new Set((contextSnapshot?.verification?.gates ?? []).map((gate) => gate.id))
  const missingGates = (verification.requiredGates ?? []).filter((gate) => !configuredGates.has(gate))
  if (missingGates.length > 0) {
    candidates.push(contradiction(
      'required-verification-gate-not-configured',
      'The interview requires verification Gates that are not configured in this source binding.',
      ['verification'],
      ['verification.gates'],
      { gates: missingGates }
    ))
  }

  const portableMigration = factFrom(contextSnapshot, 'database.migration.present')
  const migration = portableMigration ?? factFrom(contextSnapshot, 'database.flyway.present')
  if (data.requiresMigration === true && !(migration?.status === 'confirmed' && migration.value === true)) {
    candidates.push(contradiction(
      'migration-required-without-configured-mechanism',
      portableMigration
        ? 'The interview requires a migration but no supported migration configuration and revisions have been confirmed. Configure and verify the project mechanism; do not assume Flyway.'
        : 'The interview requires a migration but the project facts do not show a Flyway migration mechanism.',
      ['data'],
      [migration?.id ?? 'database.flyway.present'],
      { observedStatus: migration?.status ?? 'missing', observedValue: migration?.value ?? null }
    ))
  }

  const compatibilityRequired = factFrom(contextSnapshot, 'project.api.compatibility.required')
  if (
    scope.changesPublicApi === true &&
    compatibilityRequired?.status === 'confirmed' &&
    compatibilityRequired.value === true &&
    constraints.preservesCompatibility !== true
  ) {
    candidates.push(contradiction(
      'public-api-compatibility-unresolved',
      'The public API changes while project policy requires compatibility, but compatibility preservation is not confirmed.',
      ['scope', 'constraints'],
      ['project.api.compatibility.required'],
      { preservesCompatibility: constraints.preservesCompatibility ?? null }
    ))
  }

  return candidates.sort((left, right) => left.id.localeCompare(right.id))
}

export function interviewContradictions(record, contextSnapshot = null) {
  const candidates = deriveInterviewContradictions(record, contextSnapshot)
  const resolutions = record.contradictionResolutions ?? []
  const withResolution = candidates.map((candidate) => {
    const resolution = resolutions.find((entry) =>
      entry.candidateId === candidate.id &&
      entry.candidateSha256 === candidate.candidateSha256 &&
      entry.contextSnapshotSha256 === record.contextSnapshotSha256
    ) ?? null
    return { ...candidate, resolved: Boolean(resolution), resolution }
  })
  return {
    candidates: withResolution,
    unresolved: withResolution.filter((candidate) => !candidate.resolved)
  }
}

function deriveStatus(answers) {
  const byQuestion = answerMap(answers)
  const current = INTERVIEW_QUESTIONS.find((question) => byQuestion.get(question.id)?.status !== 'answered')
  return current ? 'COLLECTING' : 'READY'
}

function questionById(questionId) {
  return INTERVIEW_QUESTIONS.find((question) => question.id === questionId) ?? null
}

function observedHint(question, contextSnapshot) {
  if (!contextSnapshot) {
    return question.hint
  }
  const observations = []
  if (question.id === 'data') {
    const dialect = contextSnapshot.verification?.context?.databaseDialect
    const migrations = contextSnapshot.migrations?.tools?.flatMap((tool) => tool.revisionPaths) ?? contextSnapshot.facts
      ?.find((entry) => entry.id === 'database.flyway')?.evidence?.files ?? []
    if (dialect) {
      observations.push('감지된 DB: ' + dialect + '.')
    }
    if (migrations.length) {
      observations.push('감지된 migration(실행 검증 아님): ' + migrations.slice(0, 8).join(', ') + (migrations.length > 8 ? ' 외 추가 파일' : '') + '.')
    }
  }
  if (question.id === 'verification') {
    const gates = (contextSnapshot.verification?.gates ?? [])
      .filter((gate) => gate.required)
      .map((gate) => gate.id + (gate.minimumTests ? ' (최소 ' + gate.minimumTests + ' tests)' : ''))
    const policies = (contextSnapshot.policyGates ?? [])
      .filter((gate) => gate.required)
      .map((gate) => gate.name + ': ' + gate.checks.join(', '))
    if (gates.length) {
      observations.push('필수 실행 Gate: ' + gates.join('; ') + '.')
    }
    if (policies.length) {
      observations.push('필수 사람 검토 체크리스트(자동 실행 아님): ' + policies.join('; ') + '.')
    }
  }
  if (question.id === 'scope' || question.id === 'constraints') {
    const unresolved = (contextSnapshot.facts ?? [])
      .filter((entry) => entry.status !== 'confirmed')
      .map((entry) => entry.id + '=' + entry.status)
    if (unresolved.length) {
      observations.push('확인이 필요한 프로젝트 사실: ' + unresolved.join(', ') + '.')
    }
    const ruleIssues = (contextSnapshot.intelligence?.evaluation?.results ?? [])
      .filter((entry) => entry.status !== 'confirmed')
      .map((entry) => entry.id + '=' + entry.status)
    if (ruleIssues.length) {
      observations.push('해결이 필요한 프로젝트 규칙: ' + ruleIssues.join(', ') + '.')
    }
  }
  return observations.length ? question.hint + ' 현재 프로젝트 관찰: ' + observations.join(' ') : question.hint
}

export function currentInterviewQuestion(record) {
  if (record.status === 'FINALIZED') {
    return null
  }
  const byQuestion = answerMap(record.answers)
  return INTERVIEW_QUESTIONS.find((question) => byQuestion.get(question.id)?.status !== 'answered') ?? null
}

export function createInterviewRecord(input, options = {}) {
  const at = options.at ?? new Date().toISOString()
  const requirement = normalizeTaskText(input.requirement, 'interview requirement', 128 * 1024)
  if (!requirement) {
    throw new Error('Interview start requires a non-empty requirement.')
  }
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Interview start requires an actor.')
  }
  if (!input.sourceBinding?.fingerprint) {
    throw new Error('Interview start requires a Git source binding.')
  }
  if (!input.contextSnapshot || typeof input.contextSnapshot !== 'object') {
    throw new Error('Interview start requires a deterministic project-context snapshot.')
  }

  return {
    schemaVersion: INTERVIEW_SCHEMA_VERSION,
    taskId: assertTaskId(input.taskId),
    requirement,
    requirementSha256: digest({ requirement }),
    sourceFingerprint: input.sourceBinding.fingerprint,
    contextSnapshotSha256: digest(input.contextSnapshot),
    questionSetVersion: 1,
    status: 'COLLECTING',
    answers: [],
    contradictionResolutions: [],
    revision: 0,
    createdBy: actor,
    createdAt: at,
    updatedAt: at,
    finalizedAt: null,
    artifactDigests: null
  }
}

export function answerInterviewRecord(record, input, options = {}) {
  if (!record || record.schemaVersion !== INTERVIEW_SCHEMA_VERSION) {
    throw new Error('Interview record has an unsupported schema version.')
  }
  if (record.status === 'FINALIZED') {
    throw new Error('A finalized interview cannot be changed.')
  }
  const question = currentInterviewQuestion(record)
  if (!question) {
    throw new Error('The interview has no unanswered question.')
  }
  if (input.questionId !== question.id) {
    throw new Error('Answer must target the current question: ' + question.id)
  }
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Interview answers require an actor.')
  }
  const text = normalizeTaskText(input.text, 'interview answer', 64 * 1024)
  if (!text) {
    throw new Error('Interview answer cannot be empty.')
  }
  const answerStatus = input.status ?? 'answered'
  if (!ANSWER_STATUSES.has(answerStatus)) {
    throw new Error('Interview answer status must be answered, unknown, or conflict.')
  }

  const at = options.at ?? new Date().toISOString()
  const nextAnswer = {
    questionId: question.id,
    status: answerStatus,
    text,
    claims: normalizeClaims(question.id, input.claims, {}),
    actor,
    answeredAt: at
  }
  const answers = record.answers.filter((answer) => answer.questionId !== question.id)
  answers.push(nextAnswer)
  const status = deriveStatus(answers)
  return {
    ...record,
    answers,
    status,
    revision: record.revision + 1,
    updatedAt: at
  }
}

export function reviseInterviewRecord(record, input, options = {}) {
  if (!record || record.schemaVersion !== INTERVIEW_SCHEMA_VERSION) {
    throw new Error('Interview record has an unsupported schema version.')
  }
  if (record.status === 'FINALIZED') {
    throw new Error('A finalized interview cannot be changed.')
  }
  const question = questionById(input.questionId)
  if (!question) {
    throw new Error('Unknown interview question: ' + input.questionId)
  }
  if (!record.answers.some((answer) => answer.questionId === question.id)) {
    throw new Error('Interview answer does not exist and cannot be revised: ' + question.id)
  }
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Interview revisions require an actor.')
  }
  const text = normalizeTaskText(input.text, 'interview answer', 64 * 1024)
  if (!text) {
    throw new Error('Interview answer cannot be empty.')
  }
  const answerStatus = input.status ?? 'answered'
  if (!ANSWER_STATUSES.has(answerStatus)) {
    throw new Error('Interview answer status must be answered, unknown, or conflict.')
  }
  const at = options.at ?? new Date().toISOString()
  const answers = record.answers.map((answer) => answer.questionId === question.id
    ? { questionId: question.id, status: answerStatus, text, claims: normalizeClaims(question.id, input.claims, answer.claims ?? {}), actor, answeredAt: at }
    : answer)
  return {
    ...record,
    answers,
    status: deriveStatus(answers),
    revision: record.revision + 1,
    updatedAt: at
  }
}

export function resolveInterviewContradictionRecord(record, input, contextSnapshot, options = {}) {
  if (!record || record.schemaVersion !== INTERVIEW_SCHEMA_VERSION) throw new Error('Interview record has an unsupported schema version.')
  if (record.status === 'FINALIZED') throw new Error('A finalized interview cannot resolve contradictions.')
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  const reason = normalizeTaskText(input.reason, 'contradiction resolution reason', 4096)
  if (!actor || !reason) throw new Error('Contradiction resolution requires an actor and reason.')
  const candidate = deriveInterviewContradictions(record, contextSnapshot).find((entry) => entry.id === input.candidateId)
  if (!candidate) throw new Error('Active interview contradiction candidate not found: ' + input.candidateId)
  const at = options.at ?? new Date().toISOString()
  const contradictionResolutions = (record.contradictionResolutions ?? []).filter((entry) => entry.candidateId !== candidate.id)
  contradictionResolutions.push({
    candidateId: candidate.id,
    candidateSha256: candidate.candidateSha256,
    contextSnapshotSha256: record.contextSnapshotSha256,
    actor,
    reason,
    resolvedAt: at
  })
  return {
    ...record,
    contradictionResolutions,
    revision: record.revision + 1,
    updatedAt: at
  }
}

export function rebindInterviewRecord(record, input, options = {}) {
  if (!record || record.schemaVersion !== INTERVIEW_SCHEMA_VERSION) {
    throw new Error('Interview record has an unsupported schema version.')
  }
  if (record.status === 'FINALIZED') {
    throw new Error('A finalized interview cannot be rebound.')
  }
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Interview rebind requires an actor.')
  }
  if (!input.sourceBinding?.fingerprint || !/^[a-f0-9]{64}$/.test(input.sourceBinding.fingerprint)) {
    throw new Error('Interview rebind requires a Git source binding.')
  }
  if (!input.contextSnapshot || typeof input.contextSnapshot !== 'object') {
    throw new Error('Interview rebind requires a deterministic project-context snapshot.')
  }
  const at = options.at ?? new Date().toISOString()
  return {
    ...record,
    sourceFingerprint: input.sourceBinding.fingerprint,
    contextSnapshotSha256: digest(input.contextSnapshot),
    status: deriveStatus(record.answers),
    revision: record.revision + 1,
    bindingRevision: (record.bindingRevision ?? 0) + 1,
    updatedAt: at,
    artifactDigests: null
  }
}

export function assertInterviewFinalizable(record, currentSourceFingerprint, contradictions = { unresolved: [] }) {
  if (record.status === 'FINALIZED') {
    throw new Error('Interview is already finalized.')
  }
  if (record.status !== 'READY') {
    const current = currentInterviewQuestion(record)
    const answer = record.answers.find((entry) => entry.questionId === current?.id)
    if (answer?.status === 'unknown' || answer?.status === 'conflict') {
      throw new Error('Interview cannot finalize while ' + current.id + ' is ' + answer.status + '.')
    }
    throw new Error('Interview cannot finalize before all required questions are answered.')
  }
  if (!currentSourceFingerprint) {
    throw new Error('Interview finalization requires a current Git source binding.')
  }
  if (record.sourceFingerprint !== currentSourceFingerprint) {
    throw new Error('Project source changed during the interview. Start a new interview against the current source.')
  }
  if ((contradictions.unresolved ?? []).length > 0) {
    throw new Error('Interview cannot finalize with unresolved contradiction candidates: ' + contradictions.unresolved.map((entry) => entry.id).join(', '))
  }
}

export function finalizeInterviewRecord(record, input, options = {}) {
  assertInterviewFinalizable(record, input.currentSourceFingerprint, input.contradictions)
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Interview finalization requires an actor.')
  }
  const artifactNames = Object.keys(input.artifactDigests ?? {}).sort()
  if (
    artifactNames.join(',') !== 'context,impact,plan,requirement' ||
    Object.values(input.artifactDigests).some((value) => !/^[a-f0-9]{64}$/.test(value))
  ) {
    throw new Error('Interview finalization requires SHA-256 digests for every generated artifact.')
  }
  const at = options.at ?? new Date().toISOString()
  return {
    ...record,
    status: 'FINALIZED',
    revision: record.revision + 1,
    updatedAt: at,
    finalizedAt: at,
    finalizedBy: actor,
    artifactDigests: input.artifactDigests
  }
}

export function interviewProgress(record, contextSnapshot = null) {
  const byQuestion = answerMap(record.answers)
  const questions = INTERVIEW_QUESTIONS.map((question) => ({
    ...question,
    hint: observedHint(question, contextSnapshot),
    answer: byQuestion.get(question.id) ?? null
  }))
  const current = currentInterviewQuestion(record)
  const contradictions = interviewContradictions(record, contextSnapshot)
  return {
    status: record.status,
    answered: questions.filter((question) => question.answer?.status === 'answered').length,
    total: questions.length,
    currentQuestion: current
      ? { ...current, hint: observedHint(current, contextSnapshot) }
      : null,
    questions,
    contradictions
  }
}
