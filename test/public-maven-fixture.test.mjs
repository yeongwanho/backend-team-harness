import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { projectExecutableForPlatform } from '../src/core/platform.mjs'
import { parseProjectFixture } from '../src/evaluation/project-fixture-config.mjs'
import { mavenInvocation } from '../benchmarks/public-backend-v1/fixtures/spring/full-test-run.mjs'

test('public Spring fixture pins verification and preserves full Maven lifecycle', async () => {
  const config = JSON.parse(await readFile(new URL('../benchmarks/public-backend-v1/provider-comparison.json', import.meta.url)))
  const fixture = parseProjectFixture(config.repositories[0].tasks.find(t => t.id === 'spring-02-owner-search-whitespace').projectFixture)
  assert.ok(fixture)
  for (const file of fixture.files) {
    const bytes = await readFile(new URL('../benchmarks/public-backend-v1/' + file.fixture, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
    assert.ok(fixture.verification.gates[0].inputs.includes(file.path))
  }
  assert.deepEqual(mavenInvocation('linux', {}), { program: './mvnw', args: ['-o', '-B', 'verify'], shell: false })
  const windows = mavenInvocation('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
  assert.equal(windows.program, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(windows.args, ['/d', '/s', '/c', '"".\\mvnw.cmd" "-o" "-B" "verify""'])
  assert.equal(windows.shell, false)
  assert.equal(fixture.verification.gates[0].result.type, 'junit')
})

test('only exact known public wrappers select Windows companions', () => {
  for (const name of ['verify-public-fastapi', 'verify-public-maven']) {
    const path = './.backend-harness/bin/' + name
    assert.equal(projectExecutableForPlatform(path, 'win32'), path + '.cmd')
    assert.equal(projectExecutableForPlatform(path, 'darwin'), path)
    assert.equal(projectExecutableForPlatform(path + '-unknown', 'win32'), path + '-unknown')
    assert.equal(projectExecutableForPlatform('./tools/' + name, 'win32'), './tools/' + name)
  }
})
