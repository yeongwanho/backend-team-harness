import test from 'node:test'
import assert from 'node:assert/strict'
import { ALLOWED_TRANSITIONS, createTaskRecord, transitionTaskRecord } from '../src/core/task-state.mjs'

test('bounded exhaustive task transitions preserve approval and evidence invariants', () => {
  const initial = {
    ...createTaskRecord({ id: 'MODEL-1', context: 'Known', plan: 'Plan' }),
    state: 'CONTEXT_READY',
    revision: 1,
    planSourceFingerprint: 'a'.repeat(64),
    planArtifactSha256: 'b'.repeat(64)
  }
  const queue = [{ record: initial, depth: 0 }]
  let explored = 0

  while (queue.length) {
    const { record, depth } = queue.shift()
    explored += 1
    assert.ok(record.state !== 'PLAN_APPROVED' || record.approvalReceipt)
    assert.ok(!['VERIFIED', 'DONE'].includes(record.state) || record.lastEvidenceId)
    assert.ok(record.state !== 'DONE' || record.approvalReceipt)
    if (depth === 8) continue

    for (const target of ALLOWED_TRANSITIONS[record.state]) {
      const result = transitionTaskRecord(record, target, {
        actor: 'model-test',
        approved: target === 'PLAN_APPROVED',
        currentSourceFingerprint: 'a'.repeat(64),
        currentPlanArtifactSha256: 'b'.repeat(64),
        evidence: target === 'VERIFIED' ? { id: 'verify-model', confirmed: true } : undefined
      })
      if (result.applied) queue.push({ record: result.record, depth: depth + 1 })
    }
  }

  assert.ok(explored > 20)
})
