import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { doctorProject } from '../src/doctor.mjs'
import { initProject } from '../src/init-project.mjs'

async function preparedProject(prefix = 'bth-doctor-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, 'src/main/java/example'), { recursive: true })
  await mkdir(join(root, 'src/test/java/example'), { recursive: true })
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'src/main/java/example/App.java'), 'class App {}\n', 'utf8')
  await writeFile(join(root, 'src/test/java/example/AppTest.java'), 'class AppTest {}\n', 'utf8')
  await writeFile(join(root, 'src/main/resources/db/migration/V1__init.sql'), 'select 1;\n', 'utf8')
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\n', 'utf8')
  await chmod(join(root, 'gradlew'), 0o755)
  await initProject(root)
  return root
}

test('doctor accepts content-bearing Spring-style foundations', async () => {
  const root = await preparedProject()
  const result = await doctorProject(root)

  assert.equal(result.healthy, true)
  assert.equal(result.checks.every((entry) => entry.status === 'pass'), true)
})

test('doctor blocks a repository without a build definition or shared contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-missing-'))
  const result = await doctorProject(root)

  assert.equal(result.healthy, false)
  assert.deepEqual(
    result.checks.filter((entry) => entry.status === 'fail').map((entry) => entry.id),
    ['build-file', 'shared-contract', 'quality-gate-schema', 'verification-config']
  )
})

test('directories named like files do not produce false passes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-fake-files-'))
  await mkdir(join(root, 'build.gradle'))
  await mkdir(join(root, '.backend-harness/project.md'), { recursive: true })

  const result = await doctorProject(root)

  assert.equal(result.checks.find((entry) => entry.id === 'build-file').status, 'fail')
  assert.equal(result.checks.find((entry) => entry.id === 'shared-contract').status, 'fail')
})

test('an empty build file does not count as a build definition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-empty-build-'))
  await writeFile(join(root, 'build.gradle.kts'), '', 'utf8')

  const result = await doctorProject(root)
  const build = result.checks.find((entry) => entry.id === 'build-file')

  assert.equal(build.status, 'fail')
  assert.deepEqual(build.details.invalid, ['build.gradle.kts'])
})

test('invalid quality-gate YAML fails doctor instead of silently passing', async () => {
  const root = await preparedProject('bth-doctor-invalid-gate-')
  await writeFile(
    join(root, '.backend-harness/quality-gates/test.yaml'),
    'name: test\nchecks:\n  - selected-tests\n',
    'utf8'
  )

  const result = await doctorProject(root)
  const gateCheck = result.checks.find((entry) => entry.id === 'quality-gate-schema')

  assert.equal(result.healthy, false)
  assert.equal(gateCheck.status, 'fail')
  assert.match(gateCheck.details.diagnostics[0], /missing required key required/)
})

test('duplicate Flyway versions fail with the conflicting paths', async () => {
  const root = await preparedProject('bth-doctor-flyway-')
  await writeFile(join(root, 'src/main/resources/db/migration/V01__duplicate.sql'), 'select 2;\n', 'utf8')

  const result = await doctorProject(root)
  const flyway = result.checks.find((entry) => entry.id === 'flyway')

  assert.equal(flyway.status, 'fail')
  assert.equal(flyway.details.duplicates.length, 1)
})

test('doctor rejects a verification config that could pass without tests', async () => {
  const root = await preparedProject('bth-doctor-verification-')
  await writeFile(join(root, '.backend-harness/verification.json'), JSON.stringify({
    schemaVersion: 1,
    gates: [{
      id: 'compile',
      required: true,
      command: ['./gradlew'],
      result: { type: 'exit-code' }
    }]
  }) + '\n', 'utf8')

  const result = await doctorProject(root)
  const verification = result.checks.find((entry) => entry.id === 'verification-config')

  assert.equal(result.healthy, false)
  assert.equal(verification.status, 'fail')
  assert.match(verification.details.diagnostics[0], /required junit gate/)
})
