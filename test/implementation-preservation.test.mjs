import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkImplementationPreservation, compactPreservation, preservationGuidanceFor } from '../src/core/implementation-preservation.mjs'

const original = 'class Customer { @OneToMany List<Order> orders; void add(Order o) { if(o.isNew()) orders.add(o); } }'
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'bth-preservation-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid')
  await writeFile(join(root, 'Customer.java'), original)
  git('add', '.'); git('commit', '-m', 'fixture')
  return { root, base: git('rev-parse', 'HEAD') }
}

test('read-only comparison binds exact base and candidate bytes and does not forward source', async t => {
  const { root, base } = await fixture(t)
  const changed = original.replace('if(o.isNew())', '')
  await writeFile(join(root, 'Customer.java'), changed)
  const value = await checkImplementationPreservation(root, base, ['Customer.java'])
  assert.equal(value.status, 'review-required')
  assert.equal(value.files[0].findings[0].code, 'relationship_guard_drift')
  assert.match(value.files[0].baseSha256, /^[a-f0-9]{64}$/)
  assert.notEqual(value.files[0].baseSha256, value.files[0].candidateSha256)
  assert.doesNotMatch(JSON.stringify(value), /List|orders|isNew|synthetic@example/)
  assert.deepEqual(compactPreservation(value), value)
})

test('non-Java changes skip Git and parser entirely', async () => {
  const value = await checkImplementationPreservation('/does/not/exist', 'not-a-commit', ['service.ts'])
  assert.equal(value.status, 'not-applicable')
  assert.deepEqual(value.files, [])
})

test('oversized, invalid base, escaped, symlink and nonregular inputs cannot become clear', async t => {
  const { root, base } = await fixture(t)
  for (const paths of [['../Customer.java'], ['/Customer.java']]) assert.equal((await checkImplementationPreservation(root, base, paths)).status, 'incomplete')
  assert.equal((await checkImplementationPreservation(root, '--help', ['Customer.java'])).status, 'incomplete')
  await writeFile(join(root, 'Customer.java'), ' '.repeat(65537))
  assert.equal((await checkImplementationPreservation(root, base, ['Customer.java'])).status, 'incomplete')
  if (process.platform !== 'win32') {
    await rm(join(root, 'Customer.java'))
    await symlink('Other.java', join(root, 'Customer.java'))
    assert.equal((await checkImplementationPreservation(root, base, ['Customer.java'])).status, 'incomplete')
  }
})

test('unchanged source and newly added Java file need no new parser work', async t => {
  const { root, base } = await fixture(t)
  assert.equal((await checkImplementationPreservation(root, base, ['Customer.java'])).status, 'not-applicable')
  await writeFile(join(root, 'New.java'), 'class New {}')
  assert.equal((await checkImplementationPreservation(root, base, ['New.java'])).status, 'not-applicable')
})

test('bounded projection does not trust persisted authority, code, locations or arbitrary fields', () => {
  const value = compactPreservation({ schemaVersion: 1, status: 'review-required', authority: 'safe', files: [{
    path: 'Customer.java', baseSha256: 'a'.repeat(64), candidateSha256: 'b'.repeat(64), status: 'review-required',
    findings: [{ code: 'relationship_guard_drift', line: 2, baselineLine: 1, source: 'private' }, { code: 'run_shell', line: 3, baselineLine: 2 }],
    source: 'private'
  }], source: 'private' })
  assert.equal(value.authority, 'structural-review-not-semantic-proof')
  assert.equal(value.files[0].findings.length, 1)
  assert.doesNotMatch(JSON.stringify(value), /private|run_shell|"safe"/)
})

test('file-count limit is explicit and holds review instead of silently certifying a partial scan', async t => {
  const { root, base } = await fixture(t)
  const value = await checkImplementationPreservation(root, base, Array.from({ length: 33 }, (_, i) => 'New' + i + '.java'))
  assert.equal(value.status, 'incomplete')
  assert.equal(value.files.length, 32)
  assert.equal(value.omittedFileCount, 1)
})

test('new Java source makes no baseline preservation claim', async t => {
  const { root, base } = await fixture(t)
  // Newly added files have no baseline preservation claim, even with relationship text.
  await writeFile(join(root, 'New.java'), 'class New { @OneToMany List<Item> items; }')
  assert.equal((await checkImplementationPreservation(root, base, ['New.java'])).status, 'not-applicable')
})

test('non-JVM projects do not spend prompt tokens on Java-specific guidance', () => {
  assert.equal(preservationGuidanceFor([{ command: ['node', 'verify.mjs'] }]), null)
  assert.equal(preservationGuidanceFor([{ command: ['./gradlew', 'test'] }]).scope, 'changed-java-direct-relationship-writes')
  assert.ok(preservationGuidanceFor([{ command: ['.\\mvnw.cmd', 'test'] }]))
  assert.ok(preservationGuidanceFor([], ['src/Customer.java']))
})
