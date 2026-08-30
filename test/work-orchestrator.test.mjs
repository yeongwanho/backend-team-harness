import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { runWork } from '../src/runtime/work-orchestrator.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

async function initializedProject(prefix, files = []) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeGradleFixture(root)
  for (const file of files) {
    await mkdir(join(root, file.path, '..'), { recursive: true })
    await writeFile(join(root, file.path), file.content, 'utf8')
  }
  initializeGit(root)
  await initProject(root)
  return root
}

test('schema work asks once before creating state and records bootstrap-only without claiming upgrades', async () => {
  const root = await initializedProject('bth-bootstrap-plan-', [{ path: 'src/main/resources/db/mysql/schema.sql', content: 'CREATE TABLE example(id int);\n' }])
  const input = {
    requirement: 'Add a column to the bootstrap schema.', taskId: 'BOOTSTRAP-1', actor: 'developer',
    decisions: { modules: ['root'], databaseImpact: 'schema', apiImpact: 'none' }
  }
  const waiting = await runWork(root, input)
  assert.equal(waiting.status, 'needs-decisions')
  assert.deepEqual(waiting.questions.map((question) => question.id), ['data.schema-strategy'])
  await assert.rejects(access(join(root, '.backend-harness/tasks/BOOTSTRAP-1')), /ENOENT/)
  const result = await runWork(root, { ...input, decisions: { ...input.decisions, schemaStrategy: 'bootstrap-only' } })
  assert.equal(result.status, 'plan-proposed')
  assert.equal(result.task.approvalReceipt, null)
  const plan = JSON.parse(await readFile(join(root, '.backend-harness/tasks/BOOTSTRAP-1/interview/plan.json'), 'utf8'))
  assert.deepEqual(plan.structuredDecisions.data, { changesDatabase: true, requiresMigration: false, bootstrapOnly: true })
  assert.match(plan.databaseAndData, /Upgrading existing databases is excluded and unverified/)
  assert.match(plan.steps.find((step) => step.id === 'database').proof, /No existing-database upgrade compatibility/)
  assert.ok(plan.declaredRequiredGates.includes('tests'))
  assert.equal(await readFile(join(root, 'src/main/resources/db/mysql/schema.sql'), 'utf8'), 'CREATE TABLE example(id int);\n')
})

test('bootstrap-only decisions cannot waive a released migration blocker', async () => {
  const path = 'src/main/resources/db/migration/V1__init.sql'
  const root = await initializedProject('bth-bootstrap-blocker-', [{ path, content: 'CREATE TABLE example(id int);\n' }])
  await writeFile(join(root, path), 'DROP TABLE example;\n')
  const result = await runWork(root, {
    requirement: 'Adjust the schema.', taskId: 'BOOTSTRAP-BLOCK', actor: 'developer',
    decisions: { modules: ['root'], databaseImpact: 'schema', schemaStrategy: 'bootstrap-only', apiImpact: 'none' }
  })
  assert.equal(result.status, 'blocked')
  assert.ok(result.blockers.some((rule) => rule.id === 'released-migration-immutable'))
})

test('a linked Alembic environment passes through actual work planning without a Flyway requirement', async () => {
  const root = await initializedProject('bth-alembic-work-', [
    { path: 'backend/alembic.ini', content: '[alembic]\nscript_location = app/alembic\n' },
    { path: 'backend/app/alembic/env.py', content: 'from alembic import context\nraise RuntimeError("not executed")\n' },
    { path: 'backend/app/alembic/versions/abcd_init.py', content: 'revision = "abcd"\ndef upgrade(): pass\ndef downgrade(): pass\n' }
  ])
  const result = await runWork(root, {
    requirement: 'Add a nullable column with upgrade and downgrade.', taskId: 'ALEMBIC-1', actor: 'developer',
    decisions: { modules: ['root'], databaseImpact: 'schema', apiImpact: 'compatible' }
  })
  assert.equal(result.status, 'plan-proposed')
  assert.equal(result.draft.draft.schemaStrategy, 'migration')
  const plan = JSON.parse(await readFile(join(root, '.backend-harness/tasks/ALEMBIC-1/interview/plan.json'), 'utf8'))
  assert.equal(plan.structuredDecisions.data.requiresMigration, true)
  assert.equal(plan.migrationMechanisms[0].kind, 'alembic')
  assert.ok(plan.migrationMechanisms[0].configurationPaths.includes('backend/alembic.ini'))
  assert.match(result.task.plan, /Observed migration setup \(not executed or verified\)/)
  assert.doesNotMatch(result.task.plan, /not executed"/)
  assert.equal(plan.contradictionResolutions.length, 0)
})

test('bth work materializes one source-bound plan and resumes it for one explicit approval', async () => {
  const root = await initializedProject('bth-work-flow-', [{
    path: 'src/main/java/example/users/UserStatusController.java',
    content: 'package example.users; @RestController class UserStatusController { @GetMapping("/users/{id}/status") String get() { return "ok"; } }\n'
  }, {
    path: 'src/test/java/example/users/UserStatusControllerTest.java',
    content: 'package example.users; class UserStatusControllerTest {}\n'
  }])
  const requirement = 'Add a backward-compatible user status lookup API without a migration.'

  const proposed = await runWork(root, {
    requirement,
    taskId: 'WORK-FLOW-1',
    actor: 'developer'
  })
  assert.equal(proposed.status, 'plan-proposed')
  assert.equal(proposed.task.state, 'PLAN_PROPOSED')
  assert.equal(proposed.draft.questions.length, 0)
  assert.deepEqual(proposed.draft.draft.modules, ['root'])
  assert.equal(proposed.draft.draft.databaseImpact, 'read')
  assert.equal(proposed.draft.draft.apiImpact, 'compatible')
  assert.match(await readFile(join(root, proposed.planPath), 'utf8'), /Human approval is still required/)

  const approved = await runWork(root, {
    requirement,
    taskId: 'WORK-FLOW-1',
    actor: 'developer'
  }, { approve: true })
  assert.equal(approved.status, 'plan-approved')
  assert.equal(approved.task.state, 'PLAN_APPROVED')
  assert.equal(approved.task.approvalReceipt.actor, 'developer')
})

test('bth work writes no task state while bounded human decisions are missing', async () => {
  const root = await initializedProject('bth-work-decisions-', [{
    path: 'users/src/main/java/example/users/UserService.java',
    content: 'package example.users; @Service class UserService {}\n'
  }, {
    path: 'billing/src/main/java/example/billing/BillingService.java',
    content: 'package example.billing; @Service class BillingService {}\n'
  }])

  const result = await runWork(root, {
    requirement: 'Improve account handling.',
    taskId: 'WORK-AMBIGUOUS-1',
    actor: 'developer'
  })
  assert.equal(result.status, 'needs-decisions')
  assert.deepEqual(result.questions.map((question) => question.id), [
    'scope.modules',
    'data.impact',
    'api.impact'
  ])
  await assert.rejects(access(join(root, '.backend-harness/tasks/WORK-AMBIGUOUS-1')), /ENOENT/)
})

test('bth work accepts only the missing explicit decisions and generates a complete plan', async () => {
  const root = await initializedProject('bth-work-explicit-', [{
    path: 'users/src/main/java/example/users/UserService.java',
    content: 'package example.users; @Service class UserService {}\n'
  }, {
    path: 'billing/src/main/java/example/billing/BillingService.java',
    content: 'package example.billing; @Service class BillingService {}\n'
  }])

  const result = await runWork(root, {
    requirement: 'Improve account handling.',
    taskId: 'WORK-EXPLICIT-1',
    actor: 'developer',
    decisions: {
      modules: ['users'],
      excludedModules: ['billing'],
      databaseImpact: 'write',
      apiImpact: 'none'
    }
  })
  assert.equal(result.status, 'plan-proposed')
  assert.equal(result.task.state, 'PLAN_PROPOSED')
  assert.deepEqual(result.draft.draft.modules, ['users'])
  assert.equal(result.draft.draft.changesDatabase, true)
  assert.equal(result.draft.draft.requiresMigration, false)
})

test('one approved bth work call reaches isolated provider implementation and every required Gate', async () => {
  const root = await initializedProject('bth-work-implementation-', [{
    path: 'src/main/java/example/users/UserStatusController.java',
    content: 'package example.users; @RestController class UserStatusController {}\n'
  }, {
    path: 'src/test/java/example/users/UserStatusControllerTest.java',
    content: 'package example.users; class UserStatusControllerTest {}\n'
  }])
  await writeFile(join(root, '.backend-harness/implementation.json'), JSON.stringify({
    schemaVersion: 2,
    adapter: {
      kind: 'provider', provider: 'codex', network: true, timeoutMs: 30_000,
      model: null, mode: 'auto', contextBudgetCharacters: null, maxBudgetUsd: null
    },
    writePolicy: { allowedPrefixes: ['src/'], maxChangedFiles: 4, maxDiffBytes: 64 * 1024 },
    recovery: { maxAttempts: 2 }
  }, null, 2) + '\n', 'utf8')
  initializeGit(root, { forcePaths: ['.gitignore', '.backend-harness/.gitignore'] })

  let request
  const result = await runWork(root, {
    requirement: 'Add a backward-compatible user status lookup API without a migration.',
    taskId: 'WORK-IMPLEMENT-1',
    actor: 'developer'
  }, {
    approve: true,
    run: true,
    allowWrite: true,
    allowNetwork: true,
    providerProbe: async () => ({ available: true, version: 'codex-fixture 1.0' }),
    providerRunner: async (_adapter, input) => {
      request = JSON.parse(await readFile(join(input.cwd, input.requestPath), 'utf8'))
      await writeFile(
        join(input.cwd, 'src/main/java/example/users/UserStatusLookup.java'),
        'package example.users; class UserStatusLookup {}\n',
        'utf8'
      )
      return {
        process: {
          exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
          startedAt: '2026-08-31T00:00:00.000Z', finishedAt: '2026-08-31T00:00:01.000Z', durationMs: 1000,
          stdout: { sha256: 'a'.repeat(64), bytes: 2, tail: '{}' },
          stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' }
        },
        metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} }
      }
    }
  })

  assert.equal(result.status, 'implementation-passed', JSON.stringify(result, null, 2))
  assert.equal(result.task.state, 'IMPLEMENTING')
  assert.equal(result.implementation.record.verification.confirmed, true)
  assert.equal(result.implementation.record.verification.tests.executed, 1)
  assert.equal(result.implementation.record.originalBoundSourceUnchanged, true)
  assert.deepEqual(result.implementation.record.implementedFiles.map((file) => file.path), [
    'src/main/java/example/users/UserStatusLookup.java'
  ])
  assert.equal(request.task.id, 'WORK-IMPLEMENT-1')
  await assert.rejects(access(join(root, 'src/main/java/example/users/UserStatusLookup.java')), /ENOENT/)
  await access(join(result.implementation.record.workspace, 'src/main/java/example/users/UserStatusLookup.java'))
})
