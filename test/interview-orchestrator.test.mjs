import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { loadTask } from '../src/core/task-store.mjs'
import {
  answerInterview,
  completeInterview,
  interviewStatus,
  rebindInterview,
  reviseInterview,
  startInterview
} from '../src/runtime/interview-orchestrator.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function initializedProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeGradleFixture(root)
  initializeGit(root)
  await initProject(root)
  return root
}

async function answerAll(root, taskId) {
  const answers = {
    acceptance: 'Existing id returns 200; missing id returns 404.',
    scope: 'Only the users application module and its tests may change.',
    data: 'No schema or stored-data change.',
    verification: 'Unit and integration tests cover success and missing-user behavior.',
    constraints: 'No public API rename and no new network dependency.'
  }
  for (const [questionId, text] of Object.entries(answers)) {
    await answerInterview(root, taskId, { questionId, text, actor: 'developer' })
  }
}

test('native interview materializes a source-bound PLAN_PROPOSED task', async () => {
  const root = await initializedProject('bth-interview-flow-')
  const started = await startInterview(root, {
    taskId: 'USER-17',
    title: 'Safe user lookup',
    requirement: 'Add a safe user lookup endpoint.',
    actor: 'developer'
  })
  assert.equal(started.progress.currentQuestion.id, 'acceptance')
  assert.equal(started.contextSnapshot.verification.gates[0].id, 'tests')

  await answerAll(root, 'USER-17')
  const ready = await interviewStatus(root, 'USER-17')
  assert.equal(ready.record.status, 'READY')

  const finalized = await completeInterview(root, 'USER-17', { actor: 'developer' })
  assert.equal(finalized.record.status, 'FINALIZED')
  assert.equal(finalized.task.state, 'PLAN_PROPOSED')
  assert.match(finalized.artifacts.plan.sourceFingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(finalized.artifacts.plan.declaredRequiredGates, ['tests'])

  const task = await loadTask(root, 'USER-17')
  assert.equal(task.record.planSourceFingerprint, finalized.artifacts.plan.sourceFingerprint)
  assert.match(task.record.plan, /Execution plan — USER-17/)
  assert.match(task.record.plan, /Human approval is still required/)
  const plan = JSON.parse(await readFile(
    join(root, '.backend-harness/tasks/USER-17/interview/plan.json'),
    'utf8'
  ))
  assert.equal(plan.databaseAndData, 'No schema or stored-data change.')

  const retried = await completeInterview(root, 'USER-17', { actor: 'developer' })
  assert.equal(retried.task.revision, task.record.revision)
})

test('interview refuses finalization after project source drift', async () => {
  const root = await initializedProject('bth-interview-drift-')
  await startInterview(root, {
    taskId: 'DRIFT-1',
    requirement: 'Change behavior safely.',
    actor: 'developer'
  })
  await answerAll(root, 'DRIFT-1')
  await writeFile(join(root, 'new-source.txt'), 'source changed\n', 'utf8')

  await assert.rejects(
    completeInterview(root, 'DRIFT-1', { actor: 'developer' }),
    /source changed during the interview/
  )
  assert.equal((await loadTask(root, 'DRIFT-1')).record.state, 'CONTEXT_MISSING')

  const rebound = await rebindInterview(root, 'DRIFT-1', { actor: 'developer' })
  assert.equal(rebound.record.status, 'READY')
  assert.notEqual(rebound.record.sourceFingerprint, 'a'.repeat(64))
  const finalized = await completeInterview(root, 'DRIFT-1', { actor: 'developer' })
  assert.equal(finalized.task.state, 'PLAN_PROPOSED')
})

test('unresolved answer blocks finalize and can be corrected in place', async () => {
  const root = await initializedProject('bth-interview-unresolved-')
  await startInterview(root, {
    taskId: 'UNKNOWN-1',
    requirement: 'Add a compatibility behavior.',
    actor: 'developer'
  })
  await answerInterview(root, 'UNKNOWN-1', {
    questionId: 'acceptance',
    text: 'Product owner has not decided.',
    actor: 'developer',
    status: 'unknown'
  })
  await assert.rejects(
    completeInterview(root, 'UNKNOWN-1', { actor: 'developer' }),
    /acceptance is unknown/
  )

  const corrected = await answerInterview(root, 'UNKNOWN-1', {
    questionId: 'acceptance',
    text: 'Compatibility behavior is returned under the existing response field.',
    actor: 'product-owner'
  })
  assert.equal(corrected.progress.currentQuestion.id, 'scope')
})

test('duplicate interview start cannot overwrite an existing task', async () => {
  const root = await initializedProject('bth-interview-duplicate-')
  const input = {
    taskId: 'DUP-1',
    requirement: 'Add endpoint.',
    actor: 'developer'
  }
  await startInterview(root, input)
  await assert.rejects(startInterview(root, input), /Interview already exists/)
})

test('finalized plan artifact tampering is detected before reuse', async () => {
  const root = await initializedProject('bth-interview-artifact-tamper-')
  await startInterview(root, {
    taskId: 'ARTIFACT-1',
    requirement: 'Add endpoint.',
    actor: 'developer'
  })
  await answerAll(root, 'ARTIFACT-1')
  await completeInterview(root, 'ARTIFACT-1', { actor: 'developer' })
  const planPath = join(root, '.backend-harness/tasks/ARTIFACT-1/interview/plan.json')
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  plan.objective = 'Tampered objective'
  await writeFile(planPath, JSON.stringify(plan) + '\n', 'utf8')

  await assert.rejects(interviewStatus(root, 'ARTIFACT-1'), /artifact has been altered: plan/)
})

test('concurrent answers are serialized and cannot skip a question', async () => {
  const root = await initializedProject('bth-interview-concurrent-')
  await startInterview(root, {
    taskId: 'RACE-1',
    requirement: 'Add endpoint.',
    actor: 'developer'
  })

  const results = await Promise.allSettled([
    answerInterview(root, 'RACE-1', {
      questionId: 'acceptance',
      text: 'First concrete outcome.',
      actor: 'developer-a'
    }),
    answerInterview(root, 'RACE-1', {
      questionId: 'acceptance',
      text: 'Second concrete outcome.',
      actor: 'developer-b'
    })
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const loaded = await interviewStatus(root, 'RACE-1')
  assert.equal(loaded.record.revision, 1)
  assert.equal(loaded.progress.currentQuestion.id, 'scope')
})

test('a ready interview can revise one prior decision without losing the others', async () => {
  const root = await initializedProject('bth-interview-revise-')
  await startInterview(root, {
    taskId: 'REVISE-1',
    requirement: 'Add endpoint.',
    actor: 'developer'
  })
  await answerAll(root, 'REVISE-1')

  const revised = await reviseInterview(root, 'REVISE-1', {
    questionId: 'scope',
    text: 'Only src/users and test/users may change.',
    actor: 'reviewer'
  })

  assert.equal(revised.record.status, 'READY')
  assert.equal(revised.record.answers.find((answer) => answer.questionId === 'scope').text, 'Only src/users and test/users may change.')
  assert.equal(revised.record.answers.find((answer) => answer.questionId === 'acceptance').text, 'Existing id returns 200; missing id returns 404.')
})

test('project observations specialize DB and verification questions without answering them', async () => {
  const root = await initializedProject('bth-interview-facts-')
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'src/main/resources/db/migration/V1__users.sql'), 'create table users(id bigint primary key);\n', 'utf8')
  const verificationPath = join(root, '.backend-harness/verification.json')
  const verification = JSON.parse(await readFile(verificationPath, 'utf8'))
  verification.context.databaseDialect = 'mysql'
  await writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n', 'utf8')
  initializeGit(root)

  await startInterview(root, {
    taskId: 'FACTS-1',
    requirement: 'Change user persistence.',
    actor: 'developer'
  })
  await answerInterview(root, 'FACTS-1', {
    questionId: 'acceptance',
    text: 'A user can be stored and loaded.',
    actor: 'developer'
  })
  await answerInterview(root, 'FACTS-1', {
    questionId: 'scope',
    text: 'Users persistence only.',
    actor: 'developer'
  })
  const status = await interviewStatus(root, 'FACTS-1')

  assert.equal(status.progress.currentQuestion.id, 'data')
  assert.match(status.progress.currentQuestion.hint, /mysql/i)
  assert.match(status.progress.currentQuestion.hint, /V1__users\.sql/)
  assert.equal(status.record.answers.some((answer) => answer.questionId === 'data'), false)
  assert.ok(status.contextSnapshot.policyGates.length > 0)
})
