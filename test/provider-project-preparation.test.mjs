import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeGit, runGit } from '../test-support/git-project.mjs'
import { prepareBenchmarkProjectFixture } from '../src/evaluation/provider-project-preparation.mjs'
import { inspectProjectFixture } from '../src/evaluation/project-fixture.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bth-prepared-baseline-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'project'), source = join(directory, 'source'), fixtureRoot = join(directory, 'fixtures-root')
  await mkdir(join(root, 'tests'), { recursive: true })
  await mkdir(source)
  await mkdir(join(fixtureRoot, 'fixtures'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{"name":"fixture","private":true,"scripts":{"test":"node --test"}}\n')
  await writeFile(join(root, 'tests/baseline.mjs'), 'old\n')
  const wrapper = '#!/bin/sh\nexit 0\n'
  await writeFile(join(fixtureRoot, 'fixtures/wrapper'), wrapper)
  await writeFile(join(fixtureRoot, 'fixtures/baseline.mjs'), 'fixed\n')
  initializeGit(root)
  runGit(root, ['commit', '--amend', '-qm', 'sanitized benchmark base'])
  const command = '.backend-harness/bin/fixture'
  const config = { files: [
    { path: command, fixture: 'fixtures/wrapper', sha256: hash(wrapper), expectedSha256: null, executable: true },
    { path: 'tests/baseline.mjs', fixture: 'fixtures/baseline.mjs', sha256: hash('fixed\n'), expectedSha256: hash('old\n') }
  ], workspacePreparation: null, verification: { schemaVersion: 1, gates: [{ id: 'tests', required: true, command: ['./' + command],
    inputs: [command, 'tests/baseline.mjs'], result: { type: 'junit', reports: ['reports/report.xml'], minimumTests: 1 } }] } }
  return { root, source, fixtureRoot, config }
}

test('common fixture preparation binds identical test bytes in both clean single-commit baselines', async t => {
  const projections = []
  for (const lane of ['bth', 'direct']) {
    const { root, source, fixtureRoot, config } = await setup(t)
    let call
    const result = await prepareBenchmarkProjectFixture(root, source, fixtureRoot, config, {
      prepareDependencies: async (...args) => { call = args; return null }
    })
    assert.equal(result.passed, true, lane)
    assert.equal(result.fixture.integrity.valid, true)
    assert.equal(runGit(root, ['status', '--porcelain']), '')
    assert.equal(runGit(root, ['rev-list', '--count', 'HEAD']), '1')
    assert.equal(call[0], source)
    assert.equal(call[1], root)
    assert.ok(call[3].includes('tests/baseline.mjs'))
    assert.equal(await readFile(join(root, 'tests/baseline.mjs'), 'utf8'), 'fixed\n')
    projections.push(result.fixture.files.filter(file => file.path !== '.backend-harness/implementation.json'))
  }
  assert.deepEqual(projections[0], projections[1])
})

test('common fixture preparation does not claim readiness after a dependency failure or a source edit', async t => {
  for (const kind of ['dependencies', 'source', 'fixture']) {
    const { root, source, fixtureRoot, config } = await setup(t)
    const result = await prepareBenchmarkProjectFixture(root, source, fixtureRoot, config, {
      prepareDependencies: async () => {
        if (kind === 'dependencies') return { status: 'failed', failureCode: 'offline-dependency-cache-incomplete' }
        await writeFile(join(root, kind === 'fixture' ? 'tests/baseline.mjs' : 'unexpected.mjs'), 'changed\n')
        return null
      }
    })
    assert.equal(result.passed, false, kind)
    if (kind === 'fixture') assert.equal((await inspectProjectFixture(root, config)).valid, false)
  }
})

test('common preparation refuses ordinary repositories, remote-linked clones and dirty source', async t => {
  for (const kind of ['ordinary', 'remote', 'dirty', 'history']) {
    const { root, source, fixtureRoot, config } = await setup(t)
    if (kind === 'ordinary') runGit(root, ['commit', '--amend', '-qm', 'user work'])
    if (kind === 'remote') runGit(root, ['remote', 'add', 'origin', 'https://example.invalid/public.git'])
    if (kind === 'dirty') await writeFile(join(root, 'dirty.mjs'), 'keep\n')
    if (kind === 'history') runGit(root, ['commit', '--allow-empty', '-qm', 'sanitized benchmark base'])
    let called = false
    await assert.rejects(prepareBenchmarkProjectFixture(root, source, fixtureRoot, config, {
      prepareDependencies: async () => { called = true; return null }
    }), /clean, sanitized/)
    assert.equal(called, false)
    assert.equal(await readFile(join(root, 'tests/baseline.mjs'), 'utf8'), 'old\n')
    await assert.rejects(readFile(join(root, '.backend-harness/verification.json')), { code: 'ENOENT' })
  }
  const { root, source, fixtureRoot } = await setup(t)
  await assert.rejects(prepareBenchmarkProjectFixture(root, source, fixtureRoot, null), /explicit/)
})
