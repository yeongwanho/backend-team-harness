import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

test('visit oracle variants reject unsupported arguments before any Git or provider execution', () => {
  for (const args of [[], ['--cache'], ['--provider', 'codex'], ['--cache', 'x', '--allow-network']]) {
    const result = spawnSync(process.execPath, [resolve('scripts/check-visit-oracle-variants.mjs'), ...args], {
      encoding: 'utf8', timeout: 5000, env: { PATH: '' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Expected --cache PATH/)
    assert.doesNotMatch(result.stderr, /spawn.*git|ENOENT|provider is unavailable/)
  }
})

test('visit behavioral fixture and configured case inventory stay hash-bound', async () => {
  const root = resolve('benchmarks/public-backend-v1')
  const config = JSON.parse(await readFile(resolve(root, 'provider-comparison.json'), 'utf8'))
  const acceptance = config.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === 'spring-04-future-visit').acceptance
  const fixture = await readFile(resolve(root, acceptance.files[0].fixture))
  assert.equal(createHash('sha256').update(fixture).digest('hex'), acceptance.files[0].sha256)
  for (const entry of acceptance.cases) assert.match(fixture.toString('utf8'), new RegExp('void ' + entry.name + '\\('))
  assert.doesNotMatch(fixture.toString('utf8'), /typeMismatch\.visitDate|attributeHasFieldErrorCode/)
  assert.match(fixture.toString('utf8'), /Locale\.GERMAN/)
  assert.match(fixture.toString('utf8'), /html\.contains/)
})

test('supplemental ownership audit rejects malformed arguments without execution', () => {
  for (const args of [[], ['--cache', 'x'], ['--cache', 'x', '--provider', 'codex']]) {
    const result = spawnSync(process.execPath, [resolve('scripts/audit-pet-ownership.mjs'), ...args], {
      encoding: 'utf8', timeout: 5000, env: { PATH: '' },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Expected --cache PATH --runs PAIR_DIRECTORY/)
    assert.doesNotMatch(result.stderr, /spawn.*git|ENOENT|provider is unavailable/)
  }
})

test('the next pet oracle includes the cross-owner row regression with pinned fixtures', async () => {
  const root = resolve('benchmarks/public-backend-v1')
  const config = JSON.parse(await readFile(resolve(root, 'provider-comparison.json'), 'utf8'))
  const acceptance = config.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === 'spring-06-pet-update').acceptance
  assert.equal(acceptance.files.length, 2)
  assert.equal(acceptance.reports.length, 2)
  assert.equal(acceptance.cases.length, 5)
  assert.ok(acceptance.command.includes('-Dtest=PetUpdateAcceptanceTests,PetOwnershipAcceptanceTests'))
  for (const file of acceptance.files) {
    const bytes = await readFile(resolve(root, file.fixture))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256)
  }
  assert.ok(acceptance.cases.some(c => c.name === 'doesNotModifyOrReparentAnotherOwnersPersistentPet'))
})
