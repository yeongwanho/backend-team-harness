import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const names = ['codex-native-spring-pair.json', 'oracle-mutations.json', 'spring-git-contract.json', 'qa.json', 'corpus-ledger.json']
const bytes = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(directory, name))])))
const [pair, mutations, gitControl, qa, ledger] = names.map(name => JSON.parse(bytes[name]))
assert.equal(qa.passed, true)
assert.deepEqual(qa.results[0].suite, { tests: 634, pass: 630, fail: 0, skipped: 4 })
assert.deepEqual(qa.sourceChangesSinceComparison.map(change => change.path).sort(), ['src/core/portable-test-discovery.mjs', 'src/init-project.mjs'])
for (const record of [qa, mutations, gitControl]) {
  for (const [path, expected] of Object.entries(record.sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
}
assert.equal(pair.records.bth.score.successAt1, false)
assert.equal(pair.records.direct.score.successAt1, null)
assert.equal(pair.records.bth.score.usage.tokens.total, null)
assert.equal(pair.records.direct.score.usage.tokens.total, 381412)
assert.equal(mutations.killed, 5)
assert.equal(mutations.diagnosticCandidate.candidatePassed, true)
assert.equal(mutations.diagnosticCandidate.candidateUntouched, true)
assert.equal(gitControl.observations.protected.fixture.valid, true)
assert.equal(gitControl.observations['legacy-control'].fixture.valid, false)
assert.equal(ledger.counts.tasks, 20)
assert.equal(ledger.counts.tasksWithNativePairAttempt, 4)
assert.equal(ledger.counts.tasksWithConfirmedNativePair, 1)
const retained = {}
for (const lane of ['bth', 'direct']) {
  const raw = await readFile('/tmp/bth-v46-native-codex/codex/' + lane + '/spring-01-pet-association.json')
  assert.equal(hash(raw), pair.records[lane].originalArtifactSha256)
  const record = JSON.parse(raw)
  let candidate = record.workspace
  if (lane === 'bth') candidate = JSON.parse(await readFile(join(candidate, '.backend-harness/local/implementation/BENCH-C0C5F8BB3DD664DC.json'))).workspace
  const binding = await captureConfiguredSourceBinding(candidate)
  assert.equal(binding.fingerprint, pair.integrity[lane].finalSourceFingerprint)
  retained[lane] = { originalArtifactUnchanged: true, candidateUnchanged: true, fingerprint: binding.fingerprint }
}
const install = await readFile('/tmp/bth-v46-install.log', 'utf8')
assert.match(install, /Installed package smoke passed for backend-team-harness@0\.9\.0/)
execFileSync(process.execPath, ['--test', 'test/docs-contract.test.mjs'], { cwd: root })
execFileSync('git', ['diff', '--cached', '--check'], { cwd: root })
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
assert.ok(staged.includes('src/init-project.mjs'))
const stagedHashes = {}
for (const path of staged) {
  const current = await readFile(join(root, path))
  const blob = execFileSync('git', ['show', ':' + path], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(hash(blob), hash(current), 'Git must preserve staged bytes: ' + path)
  stagedHashes[path] = hash(blob)
}
const exposure = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAIza[A-Za-z0-9_-]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\/Users\/|\/var\/folders\//
for (const [name, content] of Object.entries(bytes)) assert.ok(!exposure.test(content.toString()), 'Secret or local personal path in ' + name)
await writeFile(join(directory, 'final-audit.json'), JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(),
  sourceParent: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  stagedHashes, artifactHashes: Object.fromEntries(names.map(name => [name, hash(bytes[name])])), retained,
  install: { passed: true, version: '0.9.0', logSha256: hash(install) }, finalDocumentationContractPassed: true,
  stagedBytesMatch: true, exposureScanPassed: true, corpusCounts: ledger.counts, goalComplete: false,
  limitations: ['Pattern scans do not prove absence of every possible sensitive value.',
    'Post-comparison Git fixes and subsequent QA do not change original provider trial outcomes.'] }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ stagedFiles: staged.length, retained, installPassed: true, goalComplete: false }))
