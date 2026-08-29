import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import {
  advanceTask,
  createTask,
  loadTask,
  updateTaskPlan
} from '../src/core/task-store.mjs'

async function initializedProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await initProject(root)
  return root
}

test('task state is recovered by replaying the shared event log', async () => {
  const root = await initializedProject('bth-task-replay-')
  await createTask(root, {
    id: 'ORDER-17',
    title: 'Add order state',
    context: 'Synthetic requirement',
    plan: 'Change service and add a regression test.'
  })
  await advanceTask(root, 'ORDER-17', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'ORDER-17', 'PLAN_PROPOSED', { actor: 'developer' })

  const loaded = await loadTask(root, 'ORDER-17')

  assert.equal(loaded.record.state, 'PLAN_PROPOSED')
  assert.equal(loaded.record.revision, 2)
  assert.equal(loaded.events.length, 3)
  assert.match(
    await readFile(join(root, '.backend-harness/tasks/ORDER-17/task.md'), 'utf8'),
    /Current state: `PLAN_PROPOSED`/
  )
})

test('path-hostile task ids are rejected before writing', async () => {
  const root = await initializedProject('bth-task-path-')

  await assert.rejects(createTask(root, { id: '../outside' }), /cannot traverse paths/)
  await assert.rejects(createTask(root, { id: '/absolute' }), /cannot traverse paths/)
})

test('task text is bounded before it can inflate the event log', async () => {
  const root = await initializedProject('bth-task-bounds-')

  await assert.rejects(
    createTask(root, { id: 'HUGE-TITLE', title: 'x'.repeat(257) }),
    /title exceeds the 256-byte safety limit/
  )
  await createTask(root, { id: 'BOUNDED-1', context: 'Known requirement' })
  await assert.rejects(
    advanceTask(root, 'BOUNDED-1', 'CONTEXT_READY', { actor: 'a'.repeat(129) }),
    /actor exceeds the 128-byte safety limit/
  )
})

test('concurrent identical advances apply exactly once', async () => {
  const root = await initializedProject('bth-task-lock-')
  await createTask(root, { id: 'CONCURRENT-1', context: 'Known requirement' })

  const results = await Promise.all([
    advanceTask(root, 'CONCURRENT-1', 'CONTEXT_READY', { actor: 'developer-a' }),
    advanceTask(root, 'CONCURRENT-1', 'CONTEXT_READY', { actor: 'developer-b' })
  ])
  const loaded = await loadTask(root, 'CONCURRENT-1')

  assert.equal(results.filter((result) => result.applied).length, 1)
  assert.equal(loaded.record.revision, 1)
  assert.equal(loaded.events.length, 2)
})

test('changing an approved plan invalidates approval and verified evidence', async () => {
  const root = await initializedProject('bth-task-invalidate-')
  await createTask(root, {
    id: 'PLAN-1',
    context: 'Known requirement',
    plan: 'First plan'
  })
  await advanceTask(root, 'PLAN-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'PLAN-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'PLAN-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true })

  const updated = await updateTaskPlan(root, 'PLAN-1', 'Changed plan', { actor: 'developer' })

  assert.equal(updated.record.state, 'CONTEXT_READY')
  assert.equal(updated.event.audit.approvalInvalidated, true)
  assert.equal(updated.record.lastEvidenceId, null)
})

test('changing a proposed plan requires the proposal step again', async () => {
  const root = await initializedProject('bth-task-repropose-')
  await createTask(root, { id: 'REPLAN-1', context: 'Known requirement', plan: 'First plan' })
  await advanceTask(root, 'REPLAN-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'REPLAN-1', 'PLAN_PROPOSED', { actor: 'developer' })

  const updated = await updateTaskPlan(root, 'REPLAN-1', 'Second plan', { actor: 'developer' })

  assert.equal(updated.record.state, 'CONTEXT_READY')
  assert.equal(updated.event.audit.approvalInvalidated, true)
})

test('event-log tampering is detected during replay', async () => {
  const root = await initializedProject('bth-task-tamper-')
  await createTask(root, { id: 'TAMPER-1', context: 'Known requirement' })
  const eventPath = join(root, '.backend-harness/tasks/TAMPER-1/events.jsonl')
  const original = await readFile(eventPath, 'utf8')
  await writeFile(eventPath, original.replace('CONTEXT_MISSING', 'DONE'), 'utf8')

  await assert.rejects(loadTask(root, 'TAMPER-1'), /hash chain is inconsistent/)
})

test('a dead stale process lock is recovered before advancing', async () => {
  const root = await initializedProject('bth-task-stale-lock-')
  await createTask(root, { id: 'STALE-1', context: 'Known requirement' })
  const lockDir = join(root, '.backend-harness/local/locks')
  await mkdir(lockDir, { recursive: true })
  await writeFile(
    join(lockDir, 'task-STALE-1.lock'),
    JSON.stringify({ pid: 999_999_999, acquiredAt: '2000-01-01T00:00:00.000Z' }) + '\n',
    'utf8'
  )

  const result = await advanceTask(
    root,
    'STALE-1',
    'CONTEXT_READY',
    { actor: 'developer' },
    { staleMs: 0 }
  )

  assert.equal(result.applied, true)
  assert.equal(result.record.state, 'CONTEXT_READY')
})

test('concurrent stale task-lock recovery preserves a single event sequence', async () => {
  const root = await initializedProject('bth-task-stale-race-')
  await createTask(root, { id: 'STALE-RACE-1', context: 'Known requirement' })
  const lockDir = join(root, '.backend-harness/local/locks')
  await mkdir(lockDir, { recursive: true })
  await writeFile(
    join(lockDir, 'task-STALE-RACE-1.lock'),
    JSON.stringify({ pid: 999_999_999, acquiredAt: '2000-01-01T00:00:00.000Z' }) + '\n',
    'utf8'
  )

  const results = await Promise.all([
    advanceTask(root, 'STALE-RACE-1', 'CONTEXT_READY', { actor: 'developer-a' }, { staleMs: 0 }),
    advanceTask(root, 'STALE-RACE-1', 'CONTEXT_READY', { actor: 'developer-b' }, { staleMs: 0 })
  ])
  const loaded = await loadTask(root, 'STALE-RACE-1')

  assert.equal(results.filter((result) => result.applied).length, 1)
  assert.equal(loaded.record.revision, 1)
  assert.equal(loaded.events.length, 2)
})

test('a dead task recovery guard cannot permanently block later task work', async () => {
  const root = await initializedProject('bth-task-orphan-guard-')
  await createTask(root, { id: 'ORPHAN-1', context: 'Known requirement' })
  const lockPath = join(root, '.backend-harness/local/locks/task-ORPHAN-1.lock')
  await mkdir(join(root, '.backend-harness/local/locks'), { recursive: true })
  const deadOwner = {
    pid: 999_999_999,
    nonce: 'dead-owner',
    acquiredAt: new Date().toISOString()
  }
  await writeFile(lockPath, JSON.stringify(deadOwner) + '\n', 'utf8')
  await writeFile(lockPath + '.recovering', JSON.stringify({ ...deadOwner, nonce: 'dead-recovery' }) + '\n', 'utf8')

  const result = await advanceTask(
    root,
    'ORPHAN-1',
    'CONTEXT_READY',
    { actor: 'developer' },
    { staleMs: 60 * 60 * 1000, timeoutMs: 100 }
  )

  assert.equal(result.applied, true)
})
