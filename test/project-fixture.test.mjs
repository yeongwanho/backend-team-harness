import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseProjectFixture } from '../src/evaluation/project-fixture-config.mjs'
import { applyProjectFixture, inspectProjectFixture } from '../src/evaluation/project-fixture.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const command = '.backend-harness/bin/verify-fixture'
function configuration() {
  return { files: [
    { path: command, fixture: 'fixtures/verify', sha256: hash('#!/bin/sh\nexit 0\n'), expectedSha256: null, executable: true },
    { path: 'tests/base.py', fixture: 'fixtures/base.py', sha256: hash('assert True\n'), expectedSha256: hash('assert old\n') }
  ], workspacePreparation: null, verification: { schemaVersion: 1, context: { profile: 'test' }, gates: [
    { id: 'tests', command: ['./' + command], required: true, network: false, timeoutMs: 1000,
      inputs: [command, 'tests/base.py'], result: { type: 'junit', reports: ['.backend-harness/local/reports/tests/junit.xml'], minimumTests: 1 } }
  ] } }
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'bth-project-fixture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'project'), fixtureRoot = join(directory, 'fixture-root')
  await mkdir(join(root, 'tests'), { recursive: true })
  await mkdir(join(root, '.backend-harness/bin'), { recursive: true })
  await mkdir(join(root, '.git'))
  await mkdir(join(fixtureRoot, 'fixtures'), { recursive: true })
  await writeFile(join(root, 'tests/base.py'), 'assert old\n')
  await writeFile(join(root, '.backend-harness/implementation.json'), '{"schemaVersion":2,"adapter":null}\n')
  await writeFile(join(root, '.backend-harness/verification.json'), '{"original":"contract"}\n')
  await writeFile(join(fixtureRoot, 'fixtures/verify'), '#!/bin/sh\nexit 0\n')
  await writeFile(join(fixtureRoot, 'fixtures/base.py'), 'assert True\n')
  return { root, fixtureRoot, config: parseProjectFixture(configuration()) }
}

test('project fixtures require exact hashes, test-only replacements and protected verification inputs', () => {
  assert.equal(parseProjectFixture(null), null)
  assert.equal(parseProjectFixture(configuration()).files.length, 2)
  for (const mutate of [
    c => { c.files[0].path = '../outside' }, c => { c.files[0].path = '.git/config' },
    c => { c.files[0].fixture = '/tmp/private' }, c => { c.files[1].path = 'src/user.py' },
    c => { c.files[1].path = 'tests/.env' }, c => { c.files[1].path = 'tests/node_modules/file.py' },
    c => { c.files[1].path = '.backend-harness/verification.json' },
    c => { c.files[1].path = '.backend-harness/implementation.json' },
    c => { c.files[1].expectedSha256 = 'guess' }, c => { delete c.files[1].expectedSha256 },
    c => { c.files[1].sha256 = '' }, c => { c.files.push(c.files[1]) },
    c => { c.verification.gates[0].inputs = [command] }, c => { c.files[0].executable = 'yes' },
    c => { c.verification.gates[0].command = ['./unbound-wrapper'] }, c => { c.shell = true }
  ]) { const c=configuration(); mutate(c); assert.throws(() => parseProjectFixture(c)) }
})

test('a validated fixture publishes complete files and is idempotent without changing production source', async t => {
  const { root, fixtureRoot, config } = await fixture(t)
  await writeFile(join(root, 'application.py'), 'unchanged\n')
  const receipt = await applyProjectFixture(root, fixtureRoot, config)
  assert.ok(receipt.changedPaths.includes('tests/base.py'))
  assert.equal(await readFile(join(root, 'tests/base.py'), 'utf8'), 'assert True\n')
  assert.equal(await readFile(join(root, 'application.py'), 'utf8'), 'unchanged\n')
  assert.equal((await inspectProjectFixture(root, config)).valid, true)
  assert.deepEqual((await applyProjectFixture(root, fixtureRoot, config)).changedPaths, [])
})

test('a pinned gate command is protected without duplicating it in explicit inputs', () => {
  const c = configuration()
  c.verification.gates[0].inputs = ['tests/base.py']
  let fixture
  assert.doesNotThrow(() => { fixture = parseProjectFixture(c) })
  assert.deepEqual(fixture.verification.gates[0].inputs, ['tests/base.py'])
  assert.equal(fixture.files[0].path, command)
  c.files.push({ ...c.files[0], path: '.backend-harness/bin/unbound' })
  assert.throws(() => parseProjectFixture(c), /protected/)
})

test('hash or preimage mismatch causes no partial application', async t => {
  for (const target of ['input', 'fixture']) {
    const { root, fixtureRoot, config } = await fixture(t)
    await writeFile(target === 'input' ? join(root, 'tests/base.py') : join(fixtureRoot, 'fixtures/base.py'), 'different\n')
    const before = await readFile(join(root, '.backend-harness/verification.json'), 'utf8')
    await assert.rejects(applyProjectFixture(root, fixtureRoot, config), /hash|preimage/)
    await assert.rejects(readFile(join(root, command)), { code: 'ENOENT' })
    assert.equal(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'), before)
  }
})

test('fixture source and target symlinks are refused before writes', async t => {
  for (const source of [true, false]) {
    const { root, fixtureRoot, config } = await fixture(t)
    const path = source ? join(fixtureRoot, 'fixtures/base.py') : join(root, 'tests/base.py')
    await rm(path)
    await symlink(join(root, '.backend-harness/implementation.json'), path)
    await assert.rejects(applyProjectFixture(root, fixtureRoot, config), /symbolic link/)
    await assert.rejects(readFile(join(root, command)), { code: 'ENOENT' })
  }
})

test('a mid-commit fault rolls back only this transaction files', async t => {
  const { root, fixtureRoot, config } = await fixture(t)
  await assert.rejects(applyProjectFixture(root, fixtureRoot, config, { beforeCommit: async index => { if (index === 1) throw new Error('injected write failure') } }), /injected write failure/)
  assert.equal(await readFile(join(root, 'tests/base.py'), 'utf8'), 'assert old\n')
  await assert.rejects(readFile(join(root, command)), { code: 'ENOENT' })
  assert.equal(await readFile(join(root, '.backend-harness/verification.json'), 'utf8'), '{"original":"contract"}\n')
})

test('direct input hashes detect protected test tampering even when path lists omit it', async t => {
  const { root, fixtureRoot, config } = await fixture(t)
  await applyProjectFixture(root, fixtureRoot, config)
  await writeFile(join(root, 'tests/base.py'), 'assert compromised\n')
  const inspected = await inspectProjectFixture(root, config)
  assert.equal(inspected.valid, false)
  assert.deepEqual(inspected.mismatchedPaths, ['tests/base.py'])
})

test('bounded UTF-8 sources reject missing, oversized, invalid bytes and non-files before target writes', async t => {
  for (const kind of ['missing', 'oversized', 'encoding', 'directory']) {
    const { root, fixtureRoot, config } = await fixture(t)
    const path = join(fixtureRoot, 'fixtures/base.py')
    if (kind === 'missing' || kind === 'directory') await rm(path)
    if (kind === 'directory') await mkdir(path)
    if (kind === 'oversized') await writeFile(path, Buffer.alloc(256 * 1024 + 1, 65))
    if (kind === 'encoding') await writeFile(path, Buffer.from([0xc3, 0x28]))
    await assert.rejects(applyProjectFixture(root, fixtureRoot, config), /hash mismatch|bounded regular|UTF-8/)
    assert.equal(await readFile(join(root, 'tests/base.py'), 'utf8'), 'assert old\n')
    await assert.rejects(readFile(join(root, command)), { code: 'ENOENT' })
  }
})

test('rollback restores replaced bytes and removes all staged files', async t => {
  const { root, fixtureRoot, config } = await fixture(t)
  await assert.rejects(applyProjectFixture(root, fixtureRoot, config, {
    beforeCommit: async index => { if (index === 2) throw new Error('failure after replacement') }
  }), /failure after replacement/)
  assert.equal(await readFile(join(root, 'tests/base.py'), 'utf8'), 'assert old\n')
  await assert.rejects(readFile(join(root, command)), { code: 'ENOENT' })
  for (const path of ['tests', '.backend-harness', '.backend-harness/bin']) {
    assert.ok((await readdir(join(root, path))).every(file => !file.startsWith('.bth-fixture-')))
  }
})

test('commit and rollback refuse to clobber concurrent edits', async t => {
  for (const phase of ['commit', 'rollback']) {
    const { root, fixtureRoot, config } = await fixture(t)
    const path = phase === 'commit' ? 'tests/base.py' : command
    await assert.rejects(applyProjectFixture(root, fixtureRoot, config, {
      beforeCommit: async index => {
        if (index !== 1) return
        await writeFile(join(root, path), 'concurrent edit\n')
        if (phase === 'rollback') throw new Error('rollback trigger')
      }
    }), /preimage changed|rollback refused/)
    assert.equal(await readFile(join(root, path), 'utf8'), 'concurrent edit\n')
  }
})

test('fixture inspection fails closed for broken contracts and missing executable permissions', async t => {
  for (const path of ['.backend-harness/implementation.json', '.backend-harness/verification.json', 'tests/base.py']) {
    const { root, fixtureRoot, config } = await fixture(t)
    await applyProjectFixture(root, fixtureRoot, config)
    await writeFile(join(root, path), 'invalid\n')
    assert.ok((await inspectProjectFixture(root, config)).mismatchedPaths.includes(path))
  }
  if (process.platform !== 'win32') {
    const { root, fixtureRoot, config } = await fixture(t)
    await applyProjectFixture(root, fixtureRoot, config)
    await chmod(join(root, command), 0o644)
    assert.ok((await inspectProjectFixture(root, config)).mismatchedPaths.includes(command))
  }
})
