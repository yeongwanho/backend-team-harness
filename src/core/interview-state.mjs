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

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function answerMap(answers = []) {
  return new Map(answers.map((answer) => [answer.questionId, answer]))
}

function deriveStatus(answers) {
  const byQuestion = answerMap(answers)
  const current = INTERVIEW_QUESTIONS.find((question) => byQuestion.get(question.id)?.status !== 'answered')
  return current ? 'COLLECTING' : 'READY'
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

export function assertInterviewFinalizable(record, currentSourceFingerprint) {
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
}

export function finalizeInterviewRecord(record, input, options = {}) {
  assertInterviewFinalizable(record, input.currentSourceFingerprint)
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

export function interviewProgress(record) {
  const byQuestion = answerMap(record.answers)
  const questions = INTERVIEW_QUESTIONS.map((question) => ({
    ...question,
    answer: byQuestion.get(question.id) ?? null
  }))
  return {
    status: record.status,
    answered: questions.filter((question) => question.answer?.status === 'answered').length,
    total: questions.length,
    currentQuestion: currentInterviewQuestion(record),
    questions
  }
}
