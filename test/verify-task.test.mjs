import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { advanceTask, createTask, loadTask } from '../src/core/task-store.mjs'
import { captureConfiguredSourceBinding, verifyTask } from '../src/runtime/backend-harness.mjs'
import { verifyTask as verifyCoreTask } from '../src/core/verify-task.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function approvedProject(prefix, exitCode) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeGradleFixture(root, { exitCode })
  initializeGit(root)
  await initProject(root)
  await createTask(root, {
    id: 'VERIFY-1',
    title: 'Synthetic verification',
    context: 'Synthetic requirement',
    plan: 'Run the project-owned build test wrapper.'
  })
  await advanceTask(root, 'VERIFY-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'VERIFY-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'VERIFY-1', 'PLAN_APPROVED', {
    actor: 'developer',
    approved: true
  })
  return root
}

test('guarded build verification records command, exit code, and output hashes', async () => {
  const root = await approvedProject('bth-verify-pass-', 0)
  const result = await verifyTask(root, 'VERIFY-1', {
    evidence: {
      id: 'verify-fixed-success',
      at: new Date('2026-08-29T03:00:00.000Z')
    }
  })
  const persisted = JSON.parse(await readFile(join(root, result.evidence.path), 'utf8'))
  const sharedRun = JSON.parse(await readFile(join(root, result.run.path), 'utf8'))

  assert.equal(result.confirmed, true)
  assert.equal(result.task.state, 'VERIFIED')
  assert.deepEqual(persisted.result.gates[0].command, [
    './gradlew',
    'test',
    '--offline',
    '--no-daemon',
    '--console=plain',
    '--rerun-tasks'
  ])
  assert.equal(persisted.result.gates[0].process.exitCode, 0)
  assert.match(persisted.result.gates[0].process.stdout.sha256, /^[a-f0-9]{64}$/)
  assert.equal(persisted.result.tests.tests, 1)
  assert.equal(persisted.result.tests.executed, 1)
  assert.equal(persisted.result.evidenceTier, 'EXECUTED')
  assert.match(persisted.result.toolchain.executables[0].sha256, /^[a-f0-9]{64}$/)
  assert.equal(persisted.result.toolchain.declaredContext.profile, 'test')
  assert.match(persisted.sourceBinding.fingerprint, /^[a-f0-9]{64}$/)
  assert.equal(result.run.record.verdict, 'passed')
  assert.equal(result.run.record.evidenceTier, 'EXECUTED')
  assert.match(result.run.historyPath, /runs\/history\/.*\.json$/)
  assert.equal(JSON.stringify(persisted).includes('synthetic output that must not be copied'), false)
  assert.equal(JSON.stringify(sharedRun).includes('synthetic output that must not be copied'), false)
  assert.match(result.execution.gates[0].process.stdout.tail, /synthetic output/)
})

test('a non-zero build exit becomes VERIFY_FAILED, never VERIFIED', async () => {
  const root = await approvedProject('bth-verify-fail-', 7)
  const result = await verifyTask(root, 'VERIFY-1', {
    evidence: {
      id: 'verify-fixed-failure',
      at: new Date('2026-08-29T04:00:00.000Z')
    }
  })
  const loaded = await loadTask(root, 'VERIFY-1')

  assert.equal(result.confirmed, false)
  assert.equal(result.task.state, 'VERIFY_FAILED')
  assert.equal(loaded.record.state, 'VERIFY_FAILED')
  assert.equal(loaded.record.lastEvidenceId, 'verify-fixed-failure')
})

test('verification cannot run before human plan approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-verify-unapproved-'))
  await writeGradleFixture(root)
  await initProject(root)
  await createTask(root, { id: 'UNAPPROVED-1' })

  await assert.rejects(verifyTask(root, 'UNAPPROVED-1'), /Verification cannot start/)
  assert.equal((await loadTask(root, 'UNAPPROVED-1')).record.state, 'CONTEXT_MISSING')
})

test('generic verification core requires registry injection before changing state', async () => {
  const root = await approvedProject('bth-verify-no-registry-', 0)

  await assert.rejects(verifyCoreTask(root, 'VERIFY-1'), /injected tool registry/)
  assert.equal((await loadTask(root, 'VERIFY-1')).record.state, 'PLAN_APPROVED')
})

test('a forged evidence id cannot move a persisted task to VERIFIED', async () => {
  const root = await approvedProject('bth-verify-forged-', 0)
  await advanceTask(root, 'VERIFY-1', 'VERIFYING', { actor: 'bth.verify' })

  await assert.rejects(
    advanceTask(root, 'VERIFY-1', 'VERIFIED', {
      actor: 'bth.verify',
      evidence: { id: 'verify-does-not-exist', confirmed: true }
    }),
    /does not exist/
  )
  assert.equal((await loadTask(root, 'VERIFY-1')).record.state, 'VERIFYING')
})

test('tampered evidence blocks DONE even after a prior verified transition', async () => {
  const root = await approvedProject('bth-verify-tampered-evidence-', 0)
  const verified = await verifyTask(root, 'VERIFY-1', {
    evidence: {
      id: 'verify-before-tamper',
      at: new Date('2026-08-29T06:00:00.000Z')
    }
  })
  const path = join(root, verified.evidence.path)
  const record = JSON.parse(await readFile(path, 'utf8'))
  record.confirmed = false
  await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf8')

  await assert.rejects(
    advanceTask(root, 'VERIFY-1', 'DONE', { actor: 'developer' }),
    /altered, or not confirmed/
  )
  assert.equal((await loadTask(root, 'VERIFY-1')).record.state, 'VERIFIED')
})

test('a symlinked build wrapper is rejected before the external script runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-verify-symlink-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'bth-verify-symlink-outside-'))
  const marker = join(outside, 'executed.txt')
  const externalWrapper = join(outside, 'gradlew')
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(externalWrapper, '#!/bin/sh\nprintf executed > "' + marker + '"\n', 'utf8')
  await chmod(externalWrapper, 0o755)
  await symlink(externalWrapper, join(root, 'gradlew'))
  await writeFile(join(root, '.gitignore'), 'build/\n', 'utf8')
  initializeGit(root)
  await initProject(root)
  await createTask(root, {
    id: 'SYMLINK-1',
    context: 'Synthetic requirement',
    plan: 'Attempt guarded verification.'
  })
  await advanceTask(root, 'SYMLINK-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'SYMLINK-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'SYMLINK-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true })

  const result = await verifyTask(root, 'SYMLINK-1', {
    evidence: {
      id: 'verify-symlink-blocked',
      at: new Date('2026-08-29T05:00:00.000Z')
    }
  })

  assert.equal(result.confirmed, false)
  assert.equal(result.task.state, 'VERIFY_FAILED')
  assert.match(result.evidence.record.error.message, /symbolic link/)
  await assert.rejects(readFile(marker, 'utf8'), (error) => error.code === 'ENOENT')
})

test('a zero-test report is a failed verification even when the wrapper exits zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-verify-zero-tests-'))
  await writeGradleFixture(root, { tests: 0 })
  initializeGit(root)
  await initProject(root)
  await createTask(root, { id: 'ZERO-1', context: 'Check zero tests', plan: 'Run verification.' })
  await advanceTask(root, 'ZERO-1', 'CONTEXT_READY', { actor: 'developer' })
  await advanceTask(root, 'ZERO-1', 'PLAN_PROPOSED', { actor: 'developer' })
  await advanceTask(root, 'ZERO-1', 'PLAN_APPROVED', { actor: 'reviewer', approved: true })

  const result = await verifyTask(root, 'ZERO-1')

  assert.equal(result.confirmed, false)
  assert.equal(result.task.state, 'VERIFY_FAILED')
  assert.equal(result.evidence.record.result.gates[0].reason, 'minimum_executed_tests_not_met')
})

test('DONE is blocked when source changes after a successful verification', async () => {
  const root = await approvedProject('bth-verify-source-stale-', 0)
  await verifyTask(root, 'VERIFY-1')
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java-library }\n', 'utf8')
  const current = await captureConfiguredSourceBinding(root)

  await assert.rejects(
    advanceTask(root, 'VERIFY-1', 'DONE', { actor: 'developer' }, { currentSourceFingerprint: current.fingerprint }),
    /Source changed after verification/
  )
})
