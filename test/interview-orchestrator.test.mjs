import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { loadTask } from '../src/core/task-store.mjs'
import { inspectProjectIntelligence } from '../src/adapters/project-intelligence.mjs'
import {
  answerInterview,
  completeInterview,
  generatedProviderContext,
  interviewStatus,
  rebindInterview,
  resolveInterviewContradiction,
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
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/VisibleInInspection.java'), 'package example; class VisibleInInspection {}\n', 'utf8')
  const started = await startInterview(root, {
    taskId: 'USER-17',
    title: 'Safe user lookup',
    requirement: 'Add a safe user lookup endpoint.',
    actor: 'developer'
  })
  assert.equal(started.progress.currentQuestion.id, 'acceptance')
  assert.equal(started.contextSnapshot.verification.gates[0].id, 'tests')
  assert.deepEqual(started.contextSnapshot.intelligence.code.files, [])
  assert.equal(started.contextSnapshot.intelligence.code.snapshotProjection.filesOmitted, 1)
  assert.equal(started.contextSnapshot.intelligence.code.metrics.files, 1)

  await answerAll(root, 'USER-17')
  const ready = await interviewStatus(root, 'USER-17')
  assert.equal(ready.record.status, 'READY')

  const finalized = await completeInterview(root, 'USER-17', { actor: 'developer' })
  assert.equal(finalized.record.status, 'FINALIZED')
  assert.equal(finalized.task.state, 'PLAN_PROPOSED')
  assert.match(finalized.artifacts.plan.sourceFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(finalized.artifacts.plan.schemaVersion, 4)
  assert.deepEqual(finalized.artifacts.plan.declaredRequiredGates, ['tests'])
  assert.ok(finalized.artifacts.plan.declaredRequiredReviewChecklists.length > 0)
  assert.equal('declaredRequiredPolicyGates' in finalized.artifacts.plan, false)

  const task = await loadTask(root, 'USER-17')
  assert.equal(task.record.planSourceFingerprint, finalized.artifacts.plan.sourceFingerprint)
  assert.match(task.record.plan, /Execution plan — USER-17/)
  assert.match(task.record.plan, /Human approval is still required/)
  assert.match(task.record.plan, /Required human review checklists \(not executable\)/)
  assert.match(task.record.plan, /Deterministic project-rule evaluation/)
  assert.match(task.record.plan, /api-contract/)
  const plan = JSON.parse(await readFile(
    join(root, '.backend-harness/tasks/USER-17/interview/plan.json'),
    'utf8'
  ))
  assert.equal(plan.databaseAndData, 'No schema or stored-data change.')

  const retried = await completeInterview(root, 'USER-17', { actor: 'developer' })
  assert.equal(retried.task.revision, task.record.revision)

  const projected = generatedProviderContext(task.record, finalized)
  assert.ok(projected.length < task.record.context.length)
  assert.match(projected, /unchanged approvedPlan/)
  assert.match(projected, /Project facts needing attention:/)
  assert.match(projected, /Project rules needing attention:/)
  assert.ok(!projected.includes('Acceptance criteria:'))
  for (const modified of [
    { ...task.record, context: task.record.context + '\nKeep this custom requirement.' },
    { ...task.record, plan: task.record.plan + '\nKeep this custom plan instruction.' },
    { ...task.record, planArtifactSha256: 'a'.repeat(64) },
    { ...task.record, id: 'OTHER-1' }
  ]) assert.equal(generatedProviderContext(modified, finalized), modified.context)
  for (const modified of [
    { ...finalized, record: { ...finalized.record, status: 'READY' } },
    { ...finalized, artifacts: { ...finalized.artifacts, plan: { ...finalized.artifacts.plan, schemaVersion: 99 } } },
    { ...finalized, artifacts: { ...finalized.artifacts, plan: { ...finalized.artifacts.plan, allowedScope: 'Tampered scope' } } }
  ]) assert.equal(generatedProviderContext(task.record, modified), task.record.context)
  assert.equal(generatedProviderContext(task.record, null), task.record.context)
})

test('existing migrations do not add a database step when the interview explicitly declares no DB impact', async () => {
  const root = await initializedProject('bth-interview-no-db-impact-')
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'src/main/resources/db/migration/V1__init.sql'), 'CREATE TABLE fixture(id int);\n')
  await startInterview(root, { taskId: 'NO-DB-1', requirement: 'Change only display formatting.', actor: 'developer' })
  await answerAll(root, 'NO-DB-1')
  const result = await completeInterview(root, 'NO-DB-1', { actor: 'developer' })
  assert.equal(result.artifacts.plan.steps.some((step) => step.id === 'database'), false)
  assert.ok(result.artifacts.plan.declaredRequiredGates.includes('tests'))
})

test('legacy snapshots keep their original plan renderer and can finalize idempotently', async () => {
  const root = await initializedProject('bth-interview-legacy-render-')
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'src/main/resources/db/migration/V1__init.sql'), 'CREATE TABLE fixture(id int);\n')
  const legacy = await inspectProjectIntelligence(root)
  delete legacy.migrations
  legacy.facts = legacy.facts.filter((fact) => fact.id !== 'database.migrations')
  legacy.intelligence.facts = legacy.intelligence.facts.filter((fact) => fact.id !== 'database.migration.present')
  await startInterview(root, { taskId: 'LEGACY-RENDER', requirement: 'Change display formatting.', actor: 'developer' }, { projectIntelligence: legacy })
  await answerAll(root, 'LEGACY-RENDER')
  const first = await completeInterview(root, 'LEGACY-RENDER', { actor: 'developer' })
  assert.equal(first.artifacts.plan.steps.some((step) => step.id === 'database'), true)
  const second = await completeInterview(root, 'LEGACY-RENDER', { actor: 'developer' })
  assert.deepEqual(second.record.artifactDigests, first.record.artifactDigests)
  assert.equal(second.task.revision, first.task.revision)
})

test('interview surfaces deterministic project-rule conflicts and blocks finalization', async () => {
  const root = await initializedProject('bth-interview-rules-')
  await writeFile(join(root, '.backend-harness/project-rules.json'), JSON.stringify({
    schemaVersion: 1,
    rules: [{
      id: 'contract-required',
      description: 'This project requires a contract Gate.',
      severity: 'blocker',
      assert: { fact: 'verification.gates', operator: 'includes', value: 'contract' },
      source: { path: '.backend-harness/policies/api.md', section: 'Executable verification' }
    }]
  }, null, 2) + '\n', 'utf8')
  const started = await startInterview(root, {
    taskId: 'RULE-1',
    requirement: 'Change the public API.',
    actor: 'developer'
  })
  assert.equal(started.contextSnapshot.intelligence.evaluation.blocking, true)
  assert.match(
    started.progress.questions.find((question) => question.id === 'scope').hint,
    /contract-required=conflict/
  )
  await answerAll(root, 'RULE-1')
  await assert.rejects(
    completeInterview(root, 'RULE-1', { actor: 'developer' }),
    /contract-required=conflict/
  )
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

test('interview finalization blocks unresolved structured contradictions and records explicit resolution', async () => {
  const root = await initializedProject('bth-interview-contradiction-')
  await startInterview(root, {
    taskId: 'CONTRADICTION-1',
    requirement: 'Add a migration safely.',
    actor: 'developer'
  })
  await answerInterview(root, 'CONTRADICTION-1', { questionId: 'acceptance', text: 'Behavior is observable.', actor: 'developer' })
  await answerInterview(root, 'CONTRADICTION-1', {
    questionId: 'scope', text: 'Users only.', claims: { modules: ['users'] }, actor: 'developer'
  })
  await answerInterview(root, 'CONTRADICTION-1', {
    questionId: 'data', text: 'Migration without a data change.',
    claims: { changesDatabase: false, requiresMigration: true }, actor: 'developer'
  })
  await answerInterview(root, 'CONTRADICTION-1', {
    questionId: 'verification', text: 'Unit tests.', claims: { requiredGates: ['tests'] }, actor: 'developer'
  })
  await answerInterview(root, 'CONTRADICTION-1', {
    questionId: 'constraints', text: 'No extra constraint.', claims: { preservesCompatibility: true }, actor: 'developer'
  })

  const ready = await interviewStatus(root, 'CONTRADICTION-1')
  assert.equal(ready.record.status, 'READY')
  assert.deepEqual(ready.progress.contradictions.unresolved.map((entry) => entry.id), [
    'database-migration-without-database-change',
    'migration-required-without-configured-mechanism'
  ])
  await assert.rejects(completeInterview(root, 'CONTRADICTION-1', { actor: 'developer' }), /unresolved contradiction candidates/)

  for (const candidate of ready.progress.contradictions.unresolved) {
    await resolveInterviewContradiction(root, 'CONTRADICTION-1', {
      candidateId: candidate.id,
      actor: 'reviewer',
      reason: 'The implementation plan must add and verify the migration mechanism.'
    })
  }
  const finalized = await completeInterview(root, 'CONTRADICTION-1', { actor: 'developer' })
  assert.equal(finalized.task.state, 'PLAN_PROPOSED')
  assert.equal(finalized.artifacts.plan.structuredDecisions.data.requiresMigration, true)
  assert.equal(finalized.artifacts.plan.contradictionResolutions.length, 2)
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

test('project-owned facts remain visible in the human execution plan', async () => {
  const root = await initializedProject('bth-interview-project-facts-')
  await writeFile(join(root, '.backend-harness/project-facts.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{
      id: 'team-policy',
      version: '2026-08-30',
      authority: 'project-declared',
      facts: [{
        id: 'project.api.compatibility.required',
        status: 'confirmed',
        value: true,
        summary: 'API compatibility review is mandatory.',
        sources: [{ path: '.backend-harness/policies/api.md', section: 'Compatibility' }]
      }]
    }]
  }, null, 2) + '\n', 'utf8')
  initializeGit(root)
  await startInterview(root, {
    taskId: 'PROJECT-FACT-1',
    requirement: 'Document a compatible internal behavior.',
    actor: 'developer'
  })
  await answerAll(root, 'PROJECT-FACT-1')
  const finalized = await completeInterview(root, 'PROJECT-FACT-1', { actor: 'developer' })

  assert.match(finalized.task.plan, /project\.api\.compatibility\.required/)
  assert.match(finalized.task.plan, /API compatibility review is mandatory/)
})

test('durable interview snapshots bound large code indexes while preserving aggregate facts', async () => {
  const root = await initializedProject('bth-interview-bounded-index-')
  for (let index = 0; index < 300; index += 1) {
    const directory = join(root, 'src/main/java/example/p' + index)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'Type' + index + '.java'), 'package example.p' + index + '; class Type' + index + ' {}\n', 'utf8')
  }
  await writeFile(join(root, '.backend-harness/project-rules.json'), JSON.stringify({
    schemaVersion: 1,
    rules: [{
      id: 'late-package-required',
      description: 'A package beyond the durable projection must not be silently certified.',
      severity: 'blocker',
      assert: { fact: 'code.packages', operator: 'includes', value: 'example.p299' },
      source: { path: '.backend-harness/policies/api.md', section: 'Executable verification' }
    }]
  }, null, 2) + '\n', 'utf8')

  const started = await startInterview(root, {
    taskId: 'BOUNDED-1',
    requirement: 'Change one bounded type safely.',
    actor: 'developer'
  })
  const loaded = await interviewStatus(root, 'BOUNDED-1')
  const packageFact = loaded.contextSnapshot.intelligence.facts.find((fact) => fact.id === 'code.packages')

  assert.equal(started.contextSnapshot.intelligence.code.metrics.files, 300)
  assert.equal(loaded.contextSnapshot.intelligence.code.files.length, 0)
  assert.equal(loaded.contextSnapshot.intelligence.code.packages.length, 256)
  assert.equal(loaded.contextSnapshot.intelligence.code.snapshotProjection.packagesOmitted, 44)
  assert.equal(packageFact.status, 'unknown')
  assert.equal(packageFact.evidence.originalEntryCount, 300)
  assert.equal(loaded.contextSnapshot.intelligence.evaluation.basis, 'durable-projected-facts')
  assert.equal(loaded.contextSnapshot.intelligence.evaluation.results[0].status, 'unknown')
  assert.equal(loaded.contextSnapshot.intelligence.evaluation.blocking, true)
})
