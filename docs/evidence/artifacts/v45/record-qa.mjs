import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const names = ['nest-document-controls.json', 'nest-empty-baseline-final.json', 'prior-controls.json', 'corpus-ledger.json',
  'qa.json', 'corpus-ledger-before-git.json', 'nest-empty-baseline.json', 'nest-empty-baseline-git.json']
const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(directory, name))])))
const controls = JSON.parse(bytes[names[0]]), baseline = JSON.parse(bytes[names[1]])
const prior = JSON.parse(bytes[names[2]]), ledger = JSON.parse(bytes[names[3]])
assert.equal(JSON.parse(bytes['qa.json']).artifactHashes['corpus-ledger.json'], hash(bytes['corpus-ledger-before-git.json']))
for (const document of [controls, baseline, prior]) {
  for (const [path, expected] of Object.entries(document.sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
}
const oracle = controls.results[0].result
assert.equal(controls.controlsConfirmed, 1)
assert.equal(oracle.controls.base.cases.filter(c => c.outcome === 'failed').length, 4)
assert.equal(oracle.controls.base.cases.filter(c => c.outcome === 'passed').length, 16)
assert.equal(oracle.controls.target.cases.length, 20)
assert.equal(oracle.controls.target.passed, true)
assert.equal(baseline.providerCalls, 0)
assert.equal(baseline.verification.confirmed, false)
assert.equal(baseline.verification.tests.executed, 0)
assert.equal(baseline.emptyTestBaseline.status, 'no-tests-discovered')
assert.equal(baseline.emptyTestBaseline.baselinePassed, false)
assert.equal(baseline.mayAttemptFirstTestCreation, true)
assert.equal(baseline.sourceUnchangedDuringVerification, true)
assert.equal(baseline.fixtureIntegrity.valid, true)
assert.equal(baseline.ownedProbeRemoved, true)
assert.equal(baseline.snapshotRoundTripFixtureValid, true)
assert.equal(baseline.windowsConfiguredCheckoutValid, true)
assert.equal(ledger.counts.tasks, 20)
assert.equal(ledger.counts.configuredOracles, 12)
assert.equal(ledger.counts.tasksWithNativePairAttempt, 3)
assert.equal(ledger.counts.tasksWithConfirmedNativePair, 1)
const paths = { coverage: '/tmp/bth-v45-coverage-final.log', targeted: '/tmp/bth-v45-final-targeted-4.log',
  mutation: '/tmp/bth-v45-mutation-final.log', install: '/tmp/bth-v45-install-final.log',
  originalMutation: '/tmp/bth-v45-mutation.log', stageRed: '/tmp/bth-v45-stage-red.log',
  fixtureRed: '/tmp/bth-v45-fixture-red.log', stageGreen: '/tmp/bth-v45-stage-green-2.log' }
const logs = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path, 'utf8')])))
const summary = text => Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => {
  const match = text.match(new RegExp('^# ' + key + ' (\\d+)$', 'm')); assert.ok(match); return [key, +match[1]]
}))
const suite = summary(logs.coverage), targeted = summary(logs.targeted)
assert.deepEqual(suite, { tests: 627, pass: 623, fail: 0, skipped: 4 })
assert.deepEqual(targeted, { tests: 40, pass: 40, fail: 0, skipped: 0 })
const totals = logs.coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
assert.ok(totals)
const killed = (logs.mutation.match(/^KILLED /gm) ?? []).length
assert.equal(killed, 53)
assert.ok(!/SURVIVED|inconclusive|baseline must pass/.test(logs.mutation))
assert.ok(logs.install.includes('Installed package smoke passed'))
assert.ok(logs.originalMutation.includes('Mutation result is inconclusive'))
assert.equal(summary(logs.stageRed).fail, 1)
assert.equal(summary(logs.fixtureRed).fail, 1)
assert.equal(summary(logs.stageGreen).fail, 0)
execFileSync(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root })
execFileSync('git', ['diff', '--check'], { cwd: root })
const windowsFixture = 'benchmarks/public-backend-v1/fixtures/nest/native/verify-portable.cmd'
assert.equal(hash(execFileSync('git', ['show', ':' + windowsFixture], { cwd: root })),
  hash(await readFile(join(root, windowsFixture))), 'staged Windows fixture bytes must match the pinned file')
const modified = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const sources = [...new Set([...modified, ...added, ...Object.keys(baseline.sourceHashes), ...Object.keys(controls.sourceHashes)])]
  .filter(path => path && !/^docs\/evidence\/artifacts\/v45\/.*\.json$/.test(path)).sort()
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(join(root, path)))])))
const record = { schemaVersion: 1, recordedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  sourceHashes, artifactHashes: Object.fromEntries(names.map(name => [name, hash(bytes[name])])),
  suite, finalTargetedSuite: targeted,
  coverage: { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4] },
  mutation: { curated: 53, killed, exhaustive: false }, installPassed: true, syntaxPassed: true, diffCheckPassed: true,
  logHashes: Object.fromEntries(Object.entries(logs).map(([name, value]) => [name, hash(value)])),
  firstMutationAttempt: { countedAsPass: false, reason: 'Parser rejection escaped as an Error, not an assertion. Added explicit doesNotThrow expectation; complete mutation suite rerun.' },
  supersedes: 'qa.json records the earlier pre-staging snapshot; use this final record for source hashes.',
  priorArtifactLocations: { 'qa.json:corpus-ledger.json': 'corpus-ledger-before-git.json' },
  regressionScope: 'Final full coverage suite plus 40 targeted tests after generated-contract Git round-trip fixes; production source unchanged during these final runs.',
  gitRoundTrip: { crlfFixturePreserved: true, autocrlfModes: ['input', 'true', 'false'], forcedTextConversionControl: true },
  corpusCounts: ledger.counts, currentControlResults: prior.results.map(r => ({ taskId: r.taskId, confirmed: r.result.controlsConfirmed })),
  benchmarkProviderCalls: 0, goalComplete: false,
  commands: ['node --test test/task-acceptance.test.mjs test/isolated-git-snapshot.test.mjs test/acceptance-controls-script.test.mjs',
    'node docs/evidence/artifacts/v45/probe-nest-baseline.mjs',
    'node scripts/acceptance-controls.mjs --cache <public-cache> --output <new-json> --task <task-id>',
    'node node_modules/c8/bin/c8.js --all --include=src/**/*.mjs --check-coverage --lines 88 --branches 77 --functions 90 --reporter=text node --test --test-concurrency=4 test/*.test.mjs',
    'node scripts/mutation-smoke.mjs', 'node scripts/install-smoke.mjs', 'node scripts/check-syntax.mjs'],
  limitations: ['No native Nest model pair ran. Empty baseline discovery is not implementation success.',
    'The document oracle executes actual repositories and rendered generated mappers with mocked persistence/configuration, not a live MongoDB or full generator CLI.',
    'No new provider time/token/cost, company-policy, actual Windows or two-developer handoff result.',
    'Four optional environment-dependent tests are skipped by the default suite.',
    'Curated mutation checks are not exhaustive mutation testing or proof of zero bugs.'] }
await writeFile(join(directory, 'qa-final.json'), JSON.stringify(redactForShare(record).value, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ suite, targeted, killed, corpusCounts: ledger.counts, goalComplete: false }))
