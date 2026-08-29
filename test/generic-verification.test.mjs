import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { advanceTask, createTask } from '../src/core/task-store.mjs'
import { verifyTask } from '../src/runtime/backend-harness.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

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
})
