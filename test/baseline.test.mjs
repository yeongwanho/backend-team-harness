import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProject } from '../src/init-project.mjs'
import { updateTestBaseline } from '../src/baseline.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'
import { initializeGit, writeGradleFixture } from '../test-support/git-project.mjs'

test('a passed run can only raise, never lower, the executed-test baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-baseline-'))
  await writeGradleFixture(root, { tests: 3 })
  initializeGit(root)
  await initProject(root)
  const first = await checkProject(root)
  assert.equal(first.confirmed, true)
  assert.equal(first.result.tests.executed, 3)

  const updated = await updateTestBaseline(root)
  const config = JSON.parse(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'))
  assert.equal(updated.changed, true)
  assert.equal(config.gates[0].result.minimumTests, 3)

  const wrapper = await readFile(join(root, 'gradlew'), 'utf8')
  await writeFile(
    join(root, 'gradlew'),
    wrapper
      .replace('tests="3"', 'tests="2"')
      .replace('<testcase classname="example.VerificationTest" name="works-3"></testcase>', ''),
    'utf8'
  )
  const reduced = await checkProject(root)
  assert.equal(reduced.confirmed, false)
  assert.equal(reduced.result.gates[0].reason, 'minimum_executed_tests_not_met')
  await assert.rejects(updateTestBaseline(root), /Only a passed EXECUTED run/)
})

test('baseline update refuses a tampered latest run even when its verdict still says passed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-baseline-tampered-'))
  await writeGradleFixture(root, { tests: 3 })
  initializeGit(root)
  await initProject(root)
  await checkProject(root)
  const latestPath = join(root, '.backend-harness/local/runs/latest.json')
  const run = JSON.parse(await readFile(latestPath, 'utf8'))
  run.gates[0].result.executed = 999
  await writeFile(latestPath, JSON.stringify(run, null, 2) + '\n', 'utf8')

  await assert.rejects(updateTestBaseline(root), /seal does not match/)
})
