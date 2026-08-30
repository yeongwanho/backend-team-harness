import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { gateSignature } from '../src/core/gate-scheduler.mjs'
import { loadGateHistory, recordGateObservations } from '../src/core/gate-history-store.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function project(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  return root
}

function gate(id = 'tests') {
  return {
    id,
    required: true,
    reorderable: true,
    network: false,
    command: ['./gradlew', 'test'],
    inputs: [],
    timeoutMs: 30_000,
    result: { type: 'junit', reports: ['build/test-results/**/*.xml'], minimumTests: 1 }
  }
}

test('missing history starts empty and records bounded aggregate observations', async () => {
  const root = await project('bth-gate-history-')
  const before = await loadGateHistory(root)
  const targetGate = gate()

  assert.equal(before.status, 'missing')
  assert.deepEqual(before.entries, [])

  const first = await recordGateObservations(root, before, [{ gate: targetGate, outcome: 'failed', durationMs: 40 }], {
    at: new Date('2026-08-30T01:00:00.000Z')
  })
  const second = await recordGateObservations(root, first, [{ gate: targetGate, outcome: 'passed', durationMs: 60 }], {
    at: new Date('2026-08-30T02:00:00.000Z')
  })

  assert.equal(second.status, 'available')
  assert.equal(second.updated, true)
  assert.deepEqual(second.entries, [{
    signature: gateSignature(targetGate),
    gateId: 'tests',
    samples: 2,
    failures: 1,
    totalDurationMs: 100,
    lastObservedAt: '2026-08-30T02:00:00.000Z'
  }])
  const persisted = JSON.parse(await readFile(join(root, '.backend-harness/local/optimization/gate-history.json'), 'utf8'))
  assert.equal(persisted.gates[0].samples, 2)
  assert.equal('command' in persisted.gates[0], false)
})

test('corrupt history is an explained optimizer fallback and is never overwritten implicitly', async () => {
  const root = await project('bth-gate-history-corrupt-')
  const directory = join(root, '.backend-harness/local/optimization')
  const path = join(directory, 'gate-history.json')
  await mkdir(directory, { recursive: true })
  await writeFile(path, '{broken', 'utf8')

  const loaded = await loadGateHistory(root)
  const updated = await recordGateObservations(root, loaded, [{ gate: gate(), outcome: 'passed', durationMs: 10 }])

  assert.equal(loaded.status, 'invalid')
  assert.match(loaded.diagnostic, /invalid JSON/)
  assert.equal(updated.updated, false)
  assert.equal(await readFile(path, 'utf8'), '{broken')
})

test('a symlinked history file cannot be read or replaced', async () => {
  const root = await project('bth-gate-history-symlink-')
  const outside = await mkdtemp(join(tmpdir(), 'bth-gate-history-outside-'))
  const directory = join(root, '.backend-harness/local/optimization')
  const external = join(outside, 'history.json')
  await mkdir(directory, { recursive: true })
  await writeFile(external, JSON.stringify({ schemaVersion: 1, gates: [] }), 'utf8')
  await symlink(external, join(directory, 'gate-history.json'))

  const loaded = await loadGateHistory(root)
  const updated = await recordGateObservations(root, loaded, [{ gate: gate(), outcome: 'failed', durationMs: 10 }])

  assert.equal(loaded.status, 'invalid')
  assert.match(loaded.diagnostic, /symbolic link|unsafe/i)
  assert.equal(updated.updated, false)
  assert.deepEqual(JSON.parse(await readFile(external, 'utf8')), { schemaVersion: 1, gates: [] })
})

test('history evicts the least recently observed obsolete signature instead of freezing at capacity', async () => {
  const root = await project('bth-gate-history-capacity-')
  const entries = Array.from({ length: 512 }, (_value, index) => {
    const observedGate = gate('g' + index)
    return {
      signature: gateSignature(observedGate),
      gateId: observedGate.id,
      samples: 1,
      failures: 0,
      totalDurationMs: 10,
      lastObservedAt: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString()
    }
  })
  const newest = gate('new-gate')

  const recorded = await recordGateObservations(root, {
    root,
    status: 'available',
    entries,
    updated: false
  }, [{ gate: newest, outcome: 'failed', durationMs: 5 }], {
    at: new Date('2026-08-30T03:00:00.000Z')
  })

  assert.equal(recorded.updated, true)
  assert.equal(recorded.entries.length, 512)
  assert.ok(recorded.entries.some((entry) => entry.signature === gateSignature(newest)))
  assert.ok(!recorded.entries.some((entry) => entry.signature === entries[0].signature))
  assert.match(recorded.diagnostic, /evicted 1 stale signature/)
})
