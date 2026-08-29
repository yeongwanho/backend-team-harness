import test from 'node:test'
import assert from 'node:assert/strict'
import { createTaskRecord, transitionTaskRecord } from '../src/core/task-state.mjs'

test('illegal task transitions are rejected without mutating the record', () => {
  const record = createTaskRecord({ id: 'TASK-1', title: 'Example' }, { at: '2026-08-29T00:00:00.000Z' })
  const result = transitionTaskRecord(record, 'DONE', { actor: 'developer' })

  assert.equal(result.applied, false)
  assert.equal(result.audit.reason, 'transition_not_allowed')
  assert.equal(result.record, record)
  assert.equal(record.state, 'CONTEXT_MISSING')
})

test('plan approval requires an explicit actor and approval signal', () => {
  const proposed = { ...createTaskRecord({ id: 'TASK-2', plan: 'A concrete plan' }), state: 'PLAN_PROPOSED', revision: 2 }

  assert.equal(
    transitionTaskRecord(proposed, 'PLAN_APPROVED', { actor: 'developer' }).audit.reason,
    'explicit_human_approval_required'
  )
  const approved = transitionTaskRecord(proposed, 'PLAN_APPROVED', {
    actor: 'developer',
    approved: true,
    at: '2026-08-29T01:00:00.000Z'
  })
  assert.equal(approved.applied, true)
  assert.equal(approved.record.state, 'PLAN_APPROVED')
  assert.match(approved.record.approvalReceipt.planSha256, /^[a-f0-9]{64}$/)
  assert.equal(approved.record.approvalReceipt.actor, 'developer')
})

test('a source-bound plan cannot be approved after source drift', () => {
  const plannedSourceFingerprint = 'a'.repeat(64)
  const proposed = {
    ...createTaskRecord({ id: 'TASK-SOURCE', context: 'Known', plan: 'Bound plan' }),
    state: 'PLAN_PROPOSED',
    revision: 2,
    planSourceFingerprint: plannedSourceFingerprint
  }

  const stale = transitionTaskRecord(proposed, 'PLAN_APPROVED', {
    actor: 'reviewer',
    approved: true,
    currentSourceFingerprint: 'b'.repeat(64)
  })
  assert.equal(stale.applied, false)
  assert.equal(stale.audit.reason, 'approved_plan_source_stale')

  const approved = transitionTaskRecord(proposed, 'PLAN_APPROVED', {
    actor: 'reviewer',
    approved: true,
    currentSourceFingerprint: plannedSourceFingerprint
  })
  assert.equal(approved.applied, true)
  assert.equal(approved.record.approvalReceipt.sourceFingerprint, plannedSourceFingerprint)
})

test('VERIFIED requires confirmed evidence and DONE retains its evidence reference', () => {
  const verifying = {
    ...createTaskRecord({ id: 'TASK-3' }),
    state: 'VERIFYING',
    revision: 5
  }
  const denied = transitionTaskRecord(verifying, 'VERIFIED', {
    actor: 'bth.verify',
    evidence: { id: 'evidence-1', confirmed: false }
  })
  assert.equal(denied.applied, false)
  assert.equal(denied.audit.reason, 'confirmed_evidence_required')

  const verified = transitionTaskRecord(verifying, 'VERIFIED', {
    actor: 'bth.verify',
    evidence: { id: 'evidence-1', confirmed: true }
  })
  const done = transitionTaskRecord(verified.record, 'DONE', { actor: 'developer' })
  assert.equal(done.applied, true)
  assert.equal(done.record.lastEvidenceId, 'evidence-1')
})

test('context and plan states cannot advance without their corresponding content', () => {
  const missing = createTaskRecord({ id: 'TASK-4' })
  assert.equal(
    transitionTaskRecord(missing, 'CONTEXT_READY', { actor: 'developer' }).audit.reason,
    'context_required'
  )

  const ready = { ...missing, context: 'Requirement source', state: 'CONTEXT_READY', revision: 1 }
  assert.equal(
    transitionTaskRecord(ready, 'PLAN_PROPOSED', { actor: 'developer' }).audit.reason,
    'plan_required'
  )
})

test('an interrupted VERIFYING task can start a new serialized verification attempt', () => {
  const verifying = {
    ...createTaskRecord({ id: 'TASK-5' }),
    state: 'VERIFYING',
    revision: 4
  }
  const retried = transitionTaskRecord(verifying, 'VERIFYING', {
    actor: 'bth.verify',
    reason: 'Recover an interrupted verification attempt.'
  })

  assert.equal(retried.applied, true)
  assert.equal(retried.record.state, 'VERIFYING')
  assert.equal(retried.record.revision, 5)
})
