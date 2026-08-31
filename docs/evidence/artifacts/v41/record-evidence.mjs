// Read finished QA and public comparison records only. Does not run providers.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const write = async (name, value) => writeFile(join(directory, name), JSON.stringify(redactForShare(value).value, null, 2) + '\n')
const navRaw = await readFile('/tmp/bth-v41-navigation.json'), navigation = JSON.parse(navRaw)
assert.equal(navigation.evaluatedCount, 20)
for (const [path, expected] of Object.entries(navigation.sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
await write('navigation.json', { originalArtifactSha256: hash(navRaw), ...navigation })
const pairRaw = await readFile(join(directory, 'codex-pair.json')), pair = JSON.parse(pairRaw)
const postComparisonChanges = []
for (const [path, expected] of Object.entries(pair.sourceHashes)) {
  const currentSha256 = hash(await readFile(join(root, path)))
  if (currentSha256 !== expected) postComparisonChanges.push({ path, comparedSha256: expected, currentSha256 })
}
assert.deepEqual(postComparisonChanges.map(entry => entry.path), ['src/runtime/implementation-orchestrator.mjs'])
const logPaths = { firstRed: '/tmp/bth-v41-red.log', firstGreen: '/tmp/bth-v41-green.log',
  scoped: '/tmp/bth-v41-scoped.log', guidanceRed: '/tmp/bth-v41-guidance-red.log', guidanceGreen: '/tmp/bth-v41-guidance-green.log',
  coverage: '/tmp/bth-v41-coverage.log', mutation: '/tmp/bth-v41-mutation.log', install: '/tmp/bth-v41-install.log',
  syntax: '/tmp/bth-v41-syntax.log' }
const logs = Object.fromEntries(await Promise.all(Object.entries(logPaths).map(async ([key, path]) => [key, await readFile(path, 'utf8')])))
function summary(text) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => {
    const value = text.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))
    if (!value) throw new Error('Missing terminal TAP summary: ' + key)
    return [key, Number(value[1])]
  }))
}
const suites = Object.fromEntries(['firstRed', 'firstGreen', 'scoped', 'guidanceRed', 'guidanceGreen', 'coverage']
  .map(key => [key, { ...summary(logs[key]), logSha256: hash(logs[key]) }]))
assert.equal(suites.firstRed.fail, 4)
assert.equal(suites.firstGreen.pass, 11)
assert.equal(suites.scoped.pass, 94)
assert.equal(suites.guidanceRed.fail, 1)
assert.equal(suites.guidanceGreen.fail, 0)
assert.equal(suites.guidanceGreen.pass, 1)
assert.equal(suites.coverage.fail, 0)
assert.ok(suites.coverage.pass >= 590)
assert.equal(suites.coverage.skipped, 4)
const skippedTests = [...logs.coverage.matchAll(/^ok \d+ - (.+) # SKIP.*$/gm)].map(match => match[1])
assert.equal(skippedTests.length, 4)
const totals = logs.coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
assert.ok(totals)
const killed = (logs.mutation.match(/^KILLED /gm) ?? []).length
assert.equal(killed, 42)
assert.ok(logs.install.includes('Installed package smoke passed'))
execFileSync('git', ['diff', '--check'], { cwd: root, stdio: 'pipe' })
const resources = []
for (const label of ['bth.fastapi.productqa', 'bth.fastapi.oracle']) for (const kind of ['container', 'network']) {
  const prefix = kind === 'container' ? ['ps', '-a'] : ['network', 'ls']
  assert.equal(execFileSync('docker', [...prefix, '--filter', 'label=' + label, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim(), '')
  resources.push({ kind, label, remaining: 0 })
}
const sourcePaths = [...Object.keys(pair.sourceHashes), 'scripts/mutation-smoke.mjs', 'test/semantic-graph.test.mjs',
  'test/provider-context.test.mjs', 'test/implementation-orchestrator.test.mjs', 'test/packs.test.mjs',
  'docs/evidence/provider-navigation-v41.md', 'README.md', 'CHANGELOG.md']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
await write('qa.json', { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceHashes, suites, skippedTests, coverage: { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4] },
  syntax: { passed: true, logSha256: hash(logs.syntax) }, diffCheck: { passed: true },
  mutation: { killed, totalCurated: 42, logSha256: hash(logs.mutation), exhaustive: false },
  installSmoke: { passed: true, logSha256: hash(logs.install) }, publicFixtureResources: resources,
  providerPairSha256: hash(pairRaw), postComparisonChanges,
  postComparisonCorrection: 'Request-level failing-first correction: Java preservation guidance uses pre-projection paths. The actual frozen Python pair preceded this correction; do not call it a new-provider run of the correction.',
  limitations: ['No actual Windows, new MySQL E2E or two-developer onboarding run.',
    'Static navigation omits some relevant paths; full native provider workflow baseline is still missing.'] })
const ledger = JSON.parse(execFileSync(process.execPath, ['docs/evidence/artifacts/v35/rebuild-corpus-ledger.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
await write('corpus-ledger.json', ledger)
await write('goal-status.json', { schemaVersion: 1, goalComplete: false, newUniquePairedTasks: 0, newProviderPairs: 1,
  newModelCalls: 2, staticTasksCompared: 20, historicalCounts: ledger.counts,
  nextEvidenceGaps: ['Remaining versioned tasks and native full-workflow baselines across all three backends.',
    'Fast-mode retrieval losses and mixed-model efficiency; no universal speed or token-saving claim.',
    'Missing Claude direct path telemetry, direct CLI version provenance and auxiliary token accounting.',
    'Actual Windows, MySQL corpus and second-developer onboarding.'],
  limitations: ['Do not pool historical protocols into a current-runtime success rate or completion percentage.'] })
console.log(JSON.stringify({ tests: suites.coverage, mutationKilled: killed, ledger: ledger.counts, goalComplete: false }))
