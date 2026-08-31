import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTaskAcceptance } from '../src/evaluation/provider-benchmark-config.mjs'
import { parseProjectFixture } from '../src/evaluation/project-fixture-config.mjs'
import { parseVerificationConfig, verificationInputPaths } from '../src/config/verification.mjs'
import { portableVerificationConfig, portableVerificationTemplates } from '../src/core/portable-test-discovery.mjs'
import { initializeGit, runGit } from '../test-support/git-project.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const directory = new URL('../benchmarks/public-backend-v1/', import.meta.url)
async function task(id) {
  const config = JSON.parse(await readFile(new URL('provider-comparison.json', directory)))
  return config.repositories.flatMap(repository => repository.tasks).find(task => task.id === id)
}

test('document-update oracle pins all four runtime paths and all twenty named outcomes', async () => {
  const oracle = parseTaskAcceptance((await task('nest-04-document-find-update')).acceptance, 'document-update')
  assert.equal(oracle.kind, 'fixture-tests')
  assert.deepEqual(oracle.command, ['node', 'test/bth/run.cjs'])
  assert.equal(oracle.cases.length, 20)
  assert.equal(new Set(oracle.cases.map(c => c.name)).size, 20)
  for (const name of ['user', 'session', 'document-resource', 'all-db-resource']) {
    assert.equal(oracle.cases.filter(c => c.name.startsWith(name + ' ')).length, 5)
  }
  for (const file of oracle.files) assert.equal(hash(await readFile(new URL(file.fixture, directory))), file.sha256, file.fixture)
})

test('native Nest pins the exact generated Jest gate without a fabricated baseline test', async () => {
  const fixture = parseProjectFixture((await task('nest-06-user-email-conflict')).projectFixture)
  // Pinned corpus source detection: inline ts-jest, standalone baseUrl '.', no
  // external Jest config or script override. Actual detection is recorded in QA.
  const detection = { canGenerateVerification: true, framework: 'jest', projectPath: '.',
    buildInputs: ['package.json', 'tsconfig.json', 'package-lock.json'], moduleSearchPath: '.', testArgs: [] }
  assert.deepEqual(fixture.verification, parseVerificationConfig(JSON.stringify(portableVerificationConfig(detection))))
  const templates = portableVerificationTemplates(detection)
  assert.equal(fixture.files.length, 4)
  assert.equal(fixture.verification.gates[0].result.minimumTests, 1)
  assert.deepEqual(fixture.workspacePreparation, { kind: 'npm-ci-offline', projectPath: '.', timeoutMs: 180000 })
  for (const file of fixture.files) {
    assert.ok(file.path.startsWith('.backend-harness/bin/') || file.path === '.backend-harness/.gitattributes')
    assert.equal(file.expectedSha256, file.sha256, 'generated preimage must be unchanged')
    const template = templates.find(t => t.path === file.path)
    const bytes = await readFile(new URL(file.fixture, directory))
    assert.equal(hash(bytes), file.sha256)
    assert.equal(bytes.toString(), template.content, file.path)
    assert.equal(file.executable, template.executable ?? false)
    assert.ok(verificationInputPaths(fixture.verification, { platform: 'linux' }).map(p => p.replace(/^\.\//, '')).includes(file.path))
  }
})

test('native Windows fixture bytes survive Git staging with line-ending normalization enabled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bth-native-fixture-git-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['.gitattributes', 'verify-portable.cmd']) {
    await copyFile(new URL('fixtures/nest/native/' + name, directory), join(root, name))
  }
  initializeGit(root)
  // Positive control: forcing text conversion must actually alter this blob.
  await writeFile(join(root, '.gitattributes'), 'verify-portable.cmd text\n')
  runGit(root, ['-c', 'core.autocrlf=input', 'add', '--renormalize', '--', 'verify-portable.cmd'])
  assert.notEqual(runGit(root, ['rev-parse', ':verify-portable.cmd']),
    runGit(root, ['hash-object', '--no-filters', 'verify-portable.cmd']))
  await copyFile(new URL('fixtures/nest/native/.gitattributes', directory), join(root, '.gitattributes'))
  for (const mode of ['input', 'true', 'false']) {
    runGit(root, ['-c', 'core.autocrlf=' + mode, 'add', '--renormalize', '--', 'verify-portable.cmd'])
    const blob = runGit(root, ['show', ':verify-portable.cmd'])
    const expected = await readFile(join(root, 'verify-portable.cmd'), 'utf8')
    // runGit trims trailing whitespace, so compare the unmodified internal CRLF
    // plus the complete Git blob hash, not an LF-normalized text comparison.
    assert.equal(blob, expected.trim())
    assert.equal(runGit(root, ['rev-parse', ':verify-portable.cmd']),
      runGit(root, ['hash-object', '--no-filters', 'verify-portable.cmd']))
  }
})
