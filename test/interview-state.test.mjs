import test from 'node:test'
import assert from 'node:assert/strict'
import {
  answerInterviewRecord,
  assertInterviewFinalizable,
  createInterviewRecord,
  currentInterviewQuestion,
  finalizeInterviewRecord,
  INTERVIEW_QUESTIONS
} from '../src/core/interview-state.mjs'

function sourceBinding(fingerprint = 'a'.repeat(64)) {
  return { fingerprint, headCommit: 'b'.repeat(40) }
}

function created() {
  return createInterviewRecord({
    taskId: 'INT-1',
    requirement: 'Add a safe user lookup endpoint.',
    actor: 'developer',
    sourceBinding: sourceBinding(),
    contextSnapshot: { schemaVersion: 1, sourceBinding: sourceBinding() }
  }, { at: '2026-08-30T00:00:00.000Z' })
}

test('interview asks one stable question at a time', () => {
  let record = created()
  assert.equal(currentInterviewQuestion(record).id, 'acceptance')

  assert.throws(() => answerInterviewRecord(record, {
    questionId: 'scope',
    text: 'src/users only',
    actor: 'developer'
  }), /current question: acceptance/)

  for (const question of INTERVIEW_QUESTIONS) {
    record = answerInterviewRecord(record, {
      questionId: question.id,
      text: question.id === 'data' ? '없음' : 'Concrete answer for ' + question.id,
      actor: 'developer'
    })
  }
  assert.equal(record.status, 'READY')
  assert.equal(currentInterviewQuestion(record), null)
})

test('unknown and conflict decisions remain blocking until replaced', () => {
  let record = created()
  record = answerInterviewRecord(record, {
    questionId: 'acceptance',
    text: 'Product decision is not available yet.',
    actor: 'developer',
    status: 'unknown'
  })

  assert.equal(record.status, 'COLLECTING')
  assert.equal(currentInterviewQuestion(record).id, 'acceptance')
  assert.throws(() => assertInterviewFinalizable(record, sourceBinding().fingerprint), /is unknown/)

  record = answerInterviewRecord(record, {
    questionId: 'acceptance',
    text: 'Returns 200 for an existing id and 404 otherwise.',
    actor: 'product-owner'
  })
  assert.equal(currentInterviewQuestion(record).id, 'scope')
})

test('finalization is source-bound and requires artifact digests', () => {
  let record = created()
  for (const question of INTERVIEW_QUESTIONS) {
    record = answerInterviewRecord(record, {
      questionId: question.id,
      text: 'Resolved ' + question.id,
      actor: 'developer'
    })
  }
  assert.throws(() => assertInterviewFinalizable(record, 'c'.repeat(64)), /source changed/)
  assert.throws(() => finalizeInterviewRecord(record, {
    actor: 'developer',
    currentSourceFingerprint: sourceBinding().fingerprint,
    artifactDigests: { plan: 'not-a-digest' }
  }), /SHA-256 digests/)

  const finalized = finalizeInterviewRecord(record, {
    actor: 'developer',
    currentSourceFingerprint: sourceBinding().fingerprint,
    artifactDigests: {
      requirement: 'a'.repeat(64),
      context: 'b'.repeat(64),
      impact: 'c'.repeat(64),
      plan: 'd'.repeat(64)
    }
  })
  assert.equal(finalized.status, 'FINALIZED')
  assert.throws(() => answerInterviewRecord(finalized, {
    questionId: 'constraints',
    text: 'changed',
    actor: 'developer'
  }), /cannot be changed/)
})

test('interview inputs are bounded', () => {
  assert.throws(() => createInterviewRecord({
    taskId: 'INT-2',
    requirement: 'x'.repeat(128 * 1024 + 1),
    actor: 'developer',
    sourceBinding: sourceBinding(),
    contextSnapshot: {}
  }), /safety limit/)

  assert.throws(() => answerInterviewRecord(created(), {
    questionId: 'acceptance',
    text: 'x'.repeat(64 * 1024 + 1),
    actor: 'developer'
  }), /safety limit/)
})
