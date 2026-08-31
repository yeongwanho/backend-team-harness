import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { initProject } from '../../../../src/init-project.mjs'
import { createIsolatedGitSnapshot } from '../../../../src/evaluation/isolated-git-snapshot.mjs'
import { applyProjectFixture, inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourcePaths = ['src/init-project.mjs', 'src/core/portable-test-discovery.mjs', 'src/evaluation/isolated-git-snapshot.mjs',
  'src/evaluation/project-fixture.mjs', 'benchmarks/public-backend-v1/provider-comparison.json', 'test/harness-git-contract.test.mjs',
  'docs/evidence/artifacts/v46/probe-spring-git.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
const config = JSON.parse(await readFile(join(root, 'benchmarks/public-backend-v1/provider-comparison.json')))
const fixture = config.repositories[0].tasks.find(task => task.id === 'spring-01-pet-association').projectFixture
const baseSha = '88e37c15cf6fc8490b01bc3e8e2c800cec1ac272'
const allocation = await mkdtemp(join(tmpdir(), 'bth-v46-spring-git-'))
const git = (cwd, args) => execFileSync('git', ['-c', 'user.name=BTH Fixture Probe', '-c', 'user.email=probe@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const observations = {}
try {
  const source = join(allocation, 'source')
  await createIsolatedGitSnapshot('/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git', baseSha, source)
  await initProject(source)
  await applyProjectFixture(source, join(root, 'benchmarks/public-backend-v1'), fixture)
  git(source, ['add', '-f', '.backend-harness']); git(source, ['add', 'src/test'])
  git(source, ['commit', '-qm', 'Isolated fixture'])
  for (const kind of ['protected', 'legacy-control']) {
    if (kind === 'legacy-control') {
      await unlink(join(source, '.backend-harness/.gitattributes'))
      git(source, ['add', '-u', '.backend-harness/.gitattributes'])
      git(source, ['commit', '-qm', 'Deliberately omit byte protection'])
    }
    const checkout = join(allocation, kind)
    await createIsolatedGitSnapshot(source, git(source, ['rev-parse', 'HEAD']), checkout)
    const bytes = await readFile(join(checkout, '.backend-harness/bin/verify-public-maven.cmd'))
    observations[kind] = { fixture: await inspectProjectFixture(checkout, fixture),
      cmdSha256: hash(bytes), cmdBytes: bytes.length, crlfLines: (bytes.toString().match(/\r\n/g) ?? []).length,
      attributes: git(checkout, ['check-attr', 'text', '--', '.backend-harness/bin/verify-public-maven.cmd']) }
  }
  assert.equal(observations.protected.fixture.valid, true)
  assert.equal(observations['legacy-control'].fixture.valid, false)
  assert.deepEqual(observations['legacy-control'].fixture.mismatchedPaths, ['.backend-harness/bin/verify-public-maven.cmd'])
} finally { await rm(allocation, { recursive: true, force: true }) }
const red = await readFile('/tmp/bth-v46-git-red.log', 'utf8'), green = await readFile('/tmp/bth-v46-git-green.log', 'utf8')
assert.match(red, /# fail 5\n/); assert.match(green, /# pass 21\n/); assert.match(green, /# fail 0\n/)
await writeFile(join(directory, 'spring-git-contract.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(),
  sourceHashes, baseSha, providerCalls: 0, observations, ownedProbeRemoved: true,
  failingFirst: { logSha256: hash(red), tests: 6, pass: 1, fail: 5 }, targetedRegression: { logSha256: hash(green), tests: 21, pass: 21, fail: 0 },
  limitations: ['Actual Git checkout behavior on macOS, not actual Windows execution.',
    'Legacy control deliberately omits the contract attribute file in an owned copy; retained provider candidates are never modified.',
    'This proves a checkout defect, not the cause of the original provider interruption or validation-event verdict.'] }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify(observations))
