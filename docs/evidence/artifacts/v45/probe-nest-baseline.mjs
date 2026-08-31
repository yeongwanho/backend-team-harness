// No provider invocation. Exercise real generated verification on the pinned
// empty-test Nest base, one owned dependency tree at a time.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, statfs, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createIsolatedGitSnapshot } from '../../../../src/evaluation/isolated-git-snapshot.mjs'
import { initProject } from '../../../../src/init-project.mjs'
import { applyProjectFixture, inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'
import { parseProjectFixture } from '../../../../src/evaluation/project-fixture-config.mjs'
import { prepareWorkspaceDependencies } from '../../../../src/core/workspace-preparation.mjs'
import { verificationInputPaths } from '../../../../src/config/verification.mjs'
import { checkProject, captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { inspectEmptyTestBaseline, canAttemptBaseline } from '../../../../src/evaluation/empty-test-baseline.mjs'
import { scanProjectManifest } from '../../../../src/core/project-manifest.mjs'
import { inspectPortableTestBuild } from '../../../../src/core/portable-test-discovery.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fixtureRoot = join(root, 'benchmarks/public-backend-v1')
const corpus = JSON.parse(await readFile(join(fixtureRoot, 'corpus.json')))
const config = JSON.parse(await readFile(join(fixtureRoot, 'provider-comparison.json')))
const id = 'nest-06-user-email-conflict'
const repository = corpus.repositories.find(r => r.tasks.some(t => t.id === id))
const task = repository.tasks.find(t => t.id === id)
const fixture = parseProjectFixture(config.repositories.flatMap(r => r.tasks).find(t => t.id === id).projectFixture)
const mirror = '/tmp/bth-provider-comparison-cache-v2/nestjs-boilerplate.git'
assert.equal(execFileSync('git', ['-C', mirror, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim(), repository.url)
const owned = await mkdtemp(join(tmpdir(), 'bth-v45-nest-baseline-'))
let project = join(owned, 'initial')
const available = async () => { const fs = await statfs(owned); return fs.bavail * fs.bsize }
let record
try {
  const availableBeforeBytes = await available()
  await createIsolatedGitSnapshot(mirror, task.baseSha, project)
  await initProject(project)
  const generated = await readFile(join(project, '.backend-harness/verification.json'))
  await applyProjectFixture(project, fixtureRoot, fixture)
  execFileSync('git', ['-C', project, '-c', 'core.autocrlf=input', 'add', '-f', '--', '.backend-harness'], { stdio: 'pipe' })
  execFileSync('git', ['-C', project, '-c', 'user.name=BTH Probe', '-c', 'user.email=bth-probe@example.invalid',
    'commit', '-qm', 'prepared generated verification'], { stdio: 'pipe' })
  const preparedSha = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const checkout = join(owned, 'checkout')
  await createIsolatedGitSnapshot(project, preparedSha, checkout)
  project = checkout
  const snapshotRoundTripFixtureValid = (await inspectProjectFixture(project, fixture)).valid
  assert.equal(snapshotRoundTripFixtureValid, true, 'committed verification must survive checkout')
  const windowsCheckout = join(owned, 'windows-checkout')
  execFileSync('git', ['-c', 'core.autocrlf=true', 'clone', '--quiet', '--local', '--no-hardlinks', project, windowsCheckout], { stdio: 'pipe' })
  const windowsConfiguredCheckoutValid = (await inspectProjectFixture(windowsCheckout, fixture)).valid
  assert.equal(windowsConfiguredCheckoutValid, true, 'autocrlf=true checkout must preserve wrappers and verification JSON')
  const preparation = await prepareWorkspaceDependencies(root, project, fixture.workspacePreparation, verificationInputPaths(fixture.verification))
  const availableAfterPreparationBytes = await available()
  let checked = null, empty = null, unchanged = null, detection = null, dependencyKiB = null
  if (preparation.status === 'passed') {
    dependencyKiB = Number(execFileSync('du', ['-sk', join(project, 'node_modules')], { encoding: 'utf8' }).split(/\s+/)[0])
    const before = await captureConfiguredSourceBinding(project)
    checked = await checkProject(project)
    empty = await inspectEmptyTestBaseline(project, checked)
    unchanged = before.fingerprint === (await captureConfiguredSourceBinding(project)).fingerprint
    detection = await inspectPortableTestBuild(project, await scanProjectManifest(project))
  }
  const integrity = await inspectProjectFixture(project, fixture)
  record = { schemaVersion: 1, kind: 'real-empty-test-baseline-only', taskId: id, baseSha: task.baseSha,
    targetSha: task.targetSha, requirementSha256: task.requirementSha256, recordedAt: new Date().toISOString(),
    providerCalls: 0, modelImplementationAttempted: false, modelImplementationPassed: null,
    generatedVerificationSha256: hash(generated), preparation, detection, fixtureIntegrity: integrity,
    snapshotRoundTripFixtureValid, windowsConfiguredCheckoutValid,
    sourceUnchangedDuringVerification: unchanged,
    verification: checked ? { confirmed: checked.confirmed, failure: checked.failure, tests: checked.result?.tests,
      gates: checked.result?.gates?.map(g => ({ id: g.id, passed: g.passed, tests: g.tests })) } : null,
    emptyTestBaseline: empty, mayAttemptFirstTestCreation: canAttemptBaseline({ confirmed: checked?.confirmed, emptyTestBaseline: empty }),
    storage: { availableBeforeBytes, availableAfterPreparationBytes, dependencyKiB,
      fullNativePairAttempted: false, reason: 'Insufficient headroom for parent, implementation and oracle dependencies; no unrelated deletion.' },
    node: process.version, platform: process.platform, goalComplete: false,
    limitations: ['An empty baseline is not a passing test suite or implementation success.',
      'This probe has no provider, candidate, independent candidate acceptance, live DB, app E2E or actual Windows run.',
      'The native project fixture changes no original code, test script, package lock or assertions.'] }
} finally { await rm(owned, { recursive: true, force: true }) }
const sources = ['src/evaluation/isolated-git-snapshot.mjs', 'src/evaluation/project-fixture-config.mjs',
  'src/evaluation/project-fixture.mjs', 'src/evaluation/empty-test-baseline.mjs', 'src/core/workspace-preparation.mjs',
  'src/core/portable-test-discovery.mjs', 'src/core/jest-module-resolution.mjs', 'src/core/jest-report.mjs',
  'src/runtime/backend-harness.mjs', 'src/config/verification.mjs', 'src/init-project.mjs',
  'benchmarks/public-backend-v1/corpus.json', 'benchmarks/public-backend-v1/provider-comparison.json',
  'docs/evidence/artifacts/v45/probe-nest-baseline.mjs', ...fixture.files.map(f => 'benchmarks/public-backend-v1/' + f.fixture)]
record.sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(join(root, path)))])))
record.ownedProbeRemoved = true
await writeFile(join(directory, 'nest-empty-baseline-final.json'), JSON.stringify(redactForShare(record).value, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ preparation: record.preparation.status, verification: record.verification,
  empty: record.emptyTestBaseline?.status, mayAttempt: record.mayAttemptFirstTestCreation, storage: record.storage }))
if (!record.mayAttemptFirstTestCreation || record.sourceUnchangedDuringVerification !== true || !record.fixtureIntegrity.valid) process.exitCode = 1
