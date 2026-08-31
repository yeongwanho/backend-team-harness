import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { projectExecutableForPlatform } from '../src/core/platform.mjs'
import { parseProjectFixture } from '../src/evaluation/project-fixture-config.mjs'
import { mavenInvocation } from '../benchmarks/public-backend-v1/fixtures/spring/full-test-run.mjs'

test('public Spring fixture pins verification and preserves full Maven lifecycle', async () => {
  const config = JSON.parse(await readFile(new URL('../benchmarks/public-backend-v1/provider-comparison.json', import.meta.url)))
  for (const id of ['spring-01-pet-association', 'spring-02-owner-search-whitespace']) {
    const fixture = parseProjectFixture(config.repositories[0].tasks.find(t => t.id === id).projectFixture)
    assert.ok(fixture, id)
    for (const file of fixture.files) {
      const bytes = await readFile(new URL('../benchmarks/public-backend-v1/' + file.fixture, import.meta.url))
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path)
      assert.ok(fixture.verification.gates[0].inputs.includes(file.path))
    }
    assert.equal(fixture.verification.gates[0].result.type, 'junit')
    assert.equal(fixture.verification.gates[0].result.minimumTests, id === 'spring-01-pet-association' ? 73 : 71)
  }
  assert.deepEqual(mavenInvocation('linux', {}), { program: './mvnw', args: ['-o', '-B', 'verify'], shell: false })
  const windows = mavenInvocation('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
  assert.equal(windows.program, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(windows.args, ['/d', '/s', '/c', '"".\\mvnw.cmd" "-o" "-B" "verify""'])
  assert.equal(windows.shell, false)
})

test('pet association oracle pins every independent named case without exposing it in the project fixture', async () => {
  const config = JSON.parse(await readFile(new URL('../benchmarks/public-backend-v1/provider-comparison.json', import.meta.url)))
  const task = config.repositories[0].tasks.find(t => t.id === 'spring-01-pet-association')
  const oracle = task.acceptance
  assert.equal(oracle.kind, 'fixture-tests')
  const [file] = oracle.files
  const bytes = await readFile(new URL('../benchmarks/public-backend-v1/' + file.fixture, import.meta.url))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  assert.equal(oracle.cases.length, 10)
  assert.deepEqual(oracle.cases.map(c => c.name), [...bytes.toString().matchAll(/@Test\s+void (\w+)\(/g)].map(m => m[1]))
  assert.equal(new Set(oracle.cases.map(c => c.className)).size, 1)
  assert.equal(oracle.cases[0].className, 'org.springframework.samples.petclinic.owner.PetAssociationAcceptanceTests')
  assert.deepEqual(oracle.command, ['./mvnw', '-q', '-o', '-Dtest=PetAssociationAcceptanceTests', 'test'])
  assert.deepEqual(oracle.reports, ['target/surefire-reports/TEST-org.springframework.samples.petclinic.owner.PetAssociationAcceptanceTests.xml'])
  assert.ok(!task.projectFixture.files.some(f => f.path === file.path))
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
