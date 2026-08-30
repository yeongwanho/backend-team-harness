import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { advanceTask, createTask } from '../src/core/task-store.mjs'
import { checkProject, verifyTask } from '../src/runtime/backend-harness.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'
import { loadGateHistory, recordGateObservations } from '../src/core/gate-history-store.mjs'

test('a non-Java backend can verify through a project-owned command without a new core adapter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-generic-project-'))
  await writeFile(join(root, 'package.json'), '{"name":"generic-backend","private":true}\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'reports/\n', 'utf8')
  await writeFile(
    join(root, 'service.test.mjs'),
    'import test from "node:test"\nimport assert from "node:assert/strict"\ntest("api", () => assert.equal(2 + 2, 4))\ntest("db contract", () => assert.ok(true))\n',
    'utf8'
  )
  await writeFile(
    join(root, 'verify-project'),
    '#!/bin/sh\n"$BTH_NODE" --test service.test.mjs || exit $?\nmkdir -p reports\nprintf \'%s\\n\' \'<testsuite tests="2"><testcase name="api"/><testcase name="db contract"/></testsuite>\' > reports/junit.xml\n',
    'utf8'
  )
  await chmod(join(root, 'verify-project'), 0o755)
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests',
      required: true,
      command: ['./verify-project'],
      timeoutMs: 30000,
      result: { type: 'junit', reports: ['reports/*.xml'], minimumTests: 2 }
    }]
  }, null, 2) + '\n', 'utf8')
  await createTask(root, { id: 'GENERIC-1', context: 'Generic backend', plan: 'Run project verification.' })
  await advanceTask(root, 'GENERIC-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'GENERIC-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'GENERIC-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true })

  const result = await verifyTask(root, 'GENERIC-1')

  assert.equal(result.confirmed, true, JSON.stringify(result.evidence.record.result, null, 2))
  assert.equal(result.evidence.record.result.adapter, 'configured-verification')
  assert.equal(result.evidence.record.result.tests.tests, 2)
})

test('verification fails when a gate changes bound source during the run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-mutating-gate-'))
  await writeFile(join(root, 'source.txt'), 'before\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'reports/\n', 'utf8')
  await writeFile(
    join(root, 'mutating-verify'),
    '#!/bin/sh\nmkdir -p reports\nprintf after > source.txt\nprintf \'%s\\n\' \'<testsuite tests="1"><testcase name="passes"/></testsuite>\' > reports/junit.xml\n',
    'utf8'
  )
  await chmod(join(root, 'mutating-verify'), 0o755)
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests',
      required: true,
      command: ['./mutating-verify'],
      result: { type: 'junit', reports: ['reports/*.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')
  await createTask(root, { id: 'MUTATE-1', context: 'Detect mutation', plan: 'Run verification.' })
  await advanceTask(root, 'MUTATE-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'MUTATE-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'MUTATE-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true })

  const result = await verifyTask(root, 'MUTATE-1')

  assert.equal(result.confirmed, false)
  assert.equal(result.task.state, 'VERIFY_FAILED')
  assert.equal(result.evidence.record.result.reason, 'source_changed_during_run')
  assert.equal(result.evidence.record.result.scheduling.history.updated, false)
  assert.match(result.evidence.record.result.scheduling.history.diagnostic, /source changed/)
})

test('a network-declared gate requires explicit approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-network-gate-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'reports/\n', 'utf8')
  await writeFile(
    join(root, 'verify-network'),
    '#!/bin/sh\nmkdir -p reports\nprintf \'%s\\n\' \'<testsuite tests="1"><testcase name="network-approved"/></testsuite>\' > reports/junit.xml\n',
    'utf8'
  )
  await chmod(join(root, 'verify-network'), 0o755)
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, network: true, command: ['./verify-network'],
      result: { type: 'junit', reports: ['reports/junit.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')

  const denied = await checkProject(root)
  assert.equal(denied.confirmed, false)
  assert.equal(denied.failure.code, 'network_approval_required')

  const allowed = await checkProject(root, { allowNetwork: true })
  assert.equal(allowed.confirmed, true)
  assert.deepEqual(allowed.run.record.rerun, ['bth', 'check', '.', '--allow-network'])
})

test('adaptive verification reorders only opted-in gates and still executes every gate on PASS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-adaptive-gates-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  for (const executable of ['verify-slow', 'verify-fast']) {
    await writeFile(join(root, executable), '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(join(root, executable), 0o755)
  }
  initializeGit(root)
  await initProject(root)
  const gates = [
    {
      id: 'slow', required: true, reorderable: true, network: false,
      command: ['./verify-slow'], inputs: [], timeoutMs: 30_000,
      result: { type: 'junit', reports: ['.backend-harness/generated/slow.xml'], minimumTests: 1 }
    },
    {
      id: 'fast', required: true, reorderable: true, network: false,
      command: ['./verify-fast'], inputs: [], timeoutMs: 30_000,
      result: { type: 'junit', reports: ['.backend-harness/generated/fast.xml'], minimumTests: 1 }
    }
  ]
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    scheduling: { strategy: 'adaptive-failure-first', minimumObservations: 3, priorFailures: 1, priorPasses: 1 },
    gates
  }, null, 2) + '\n', 'utf8')
  initializeGit(root)
  let history = await loadGateHistory(root)
  for (let index = 0; index < 3; index += 1) {
    history = await recordGateObservations(root, history, [
      { gate: gates[0], outcome: 'passed', durationMs: 1000 },
      { gate: gates[1], outcome: 'failed', durationMs: 20 }
    ])
  }
  const executed = []
  const processRunner = async ({ program }) => {
    const id = program.endsWith('verify-fast') ? 'fast' : 'slow'
    executed.push(id)
    await mkdir(join(root, '.backend-harness/generated'), { recursive: true })
    await writeFile(
      join(root, '.backend-harness/generated/' + id + '.xml'),
      '<testsuite tests="1"><testcase name="' + id + '"/></testsuite>\n',
      'utf8'
    )
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      startedAt: '2026-08-30T00:00:00.000Z',
      finishedAt: '2026-08-30T00:00:00.010Z',
      durationMs: id === 'fast' ? 20 : 1000,
      stdout: { sha256: '0'.repeat(64), bytes: 0, tail: '' },
      stderr: { sha256: '0'.repeat(64), bytes: 0, tail: '' }
    }
  }

  const result = await checkProject(root, { processRunner })

  assert.equal(result.confirmed, true, JSON.stringify(result, null, 2))
  assert.deepEqual(executed, ['fast', 'slow'])
  assert.deepEqual(result.result.gates.map((entry) => entry.id), ['fast', 'slow'])
  assert.equal(result.result.scheduling.applied, true)
  assert.equal(result.run.record.scheduling.applied, true)
  assert.equal(new Set(executed).size, gates.length)
})

test('leaked descendant stdio is a distinct failed Gate even when the direct process exited zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-stdio-leak-gate-'))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  const processRunner = async () => {
    await mkdir(join(root, 'build/test-results/test'), { recursive: true })
    await writeFile(
      join(root, 'build/test-results/test/TEST-fixture.xml'),
      '<testsuite tests="1"><testcase name="ran"/></testsuite>\n',
      'utf8'
    )
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdioDrainTimedOut: true,
      startedAt: '2026-08-30T00:00:00.000Z',
      finishedAt: '2026-08-30T00:00:00.050Z',
      durationMs: 50,
      stdout: { sha256: '0'.repeat(64), bytes: 0, tail: '' },
      stderr: { sha256: '0'.repeat(64), bytes: 0, tail: '' }
    }
  }

  const result = await checkProject(root, { processRunner })

  assert.equal(result.confirmed, false)
  assert.equal(result.result.gates[0].reason, 'process_stdio_drain_timed_out')
  assert.equal(result.run.record.gates[0].process.stdioDrainTimedOut, true)
})

test('touching an old JUnit report cannot manufacture fresh executed evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-touch-old-report-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, '.gitignore'), 'reports/\n', 'utf8')
  await mkdir(join(root, 'reports'))
  await writeFile(join(root, 'reports/junit.xml'), '<testsuite tests="1"><testcase name="old"/></testsuite>\n', 'utf8')
  await writeFile(join(root, 'touch-report'), '#!/bin/sh\ntouch reports/junit.xml\n', 'utf8')
  await chmod(join(root, 'touch-report'), 0o755)
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, command: ['./touch-report'],
      result: { type: 'junit', reports: ['reports/junit.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')

  const result = await checkProject(root)

  assert.equal(result.confirmed, false)
  assert.equal(result.result.gates[0].reason, 'junit_parse_failed')
})

test('report cleanup refuses to delete a tracked source file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-tracked-report-'))
  await writeGradleFixture(root)
  await mkdir(join(root, 'docs'))
  const trackedXml = join(root, 'docs/source.xml')
  await writeFile(trackedXml, '<source>keep me</source>\n', 'utf8')
  initializeGit(root)
  await initProject(root)
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, command: ['./gradlew', 'test'],
      result: { type: 'junit', reports: ['docs/**/*.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')

  const result = await checkProject(root)

  assert.equal(result.confirmed, false)
  assert.match(result.failure.message, /tracked project file/)
  assert.equal(await readFile(trackedXml, 'utf8'), '<source>keep me</source>\n')
})

test('report cleanup refuses to delete an untracked source file that is not ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-untracked-report-'))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  await mkdir(join(root, 'notes'))
  const untrackedXml = join(root, 'notes/draft.xml')
  await writeFile(untrackedXml, '<draft>keep me</draft>\n', 'utf8')
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'tests', required: true, command: ['./gradlew', 'test'],
      result: { type: 'junit', reports: ['notes/**/*.xml'], minimumTests: 1 }
    }]
  }, null, 2) + '\n', 'utf8')

  const result = await checkProject(root)

  assert.equal(result.confirmed, false)
  assert.match(result.failure.message, /non-ignored project file/)
  assert.equal(await readFile(untrackedXml, 'utf8'), '<draft>keep me</draft>\n')
})
