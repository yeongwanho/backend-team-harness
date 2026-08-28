import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { doctorProject } from '../src/doctor.mjs'
import { initProject } from '../src/init-project.mjs'

test('doctor accepts a minimally prepared Spring-style repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-'))
  await mkdir(join(root, 'src/main/java'), { recursive: true })
  await mkdir(join(root, 'src/test/java'), { recursive: true })
  await mkdir(join(root, 'src/main/resources/db/migration'), { recursive: true })
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\n', 'utf8')
  await initProject(root)

  const result = await doctorProject(root)

  assert.equal(result.healthy, true)
  assert.equal(result.checks.every((check) => check.status === 'pass'), true)
})

test('doctor blocks a repository without a build definition or shared contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-doctor-missing-'))

  const result = await doctorProject(root)

  assert.equal(result.healthy, false)
  assert.deepEqual(
    result.checks.filter((check) => check.status === 'fail').map((check) => check.id),
    ['build-file', 'shared-contract']
  )
})

