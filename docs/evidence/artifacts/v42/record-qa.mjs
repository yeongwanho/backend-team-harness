import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const pairRaw = await readFile(join(directory, 'codex-native-pair.json')), pair = JSON.parse(pairRaw)
const postComparisonChanges = []
for (const [path, expected] of Object.entries(pair.sourceHashes)) {
  const currentSha256 = hash(await readFile(join(root, path)))
  if (currentSha256 !== expected) postComparisonChanges.push({ path, comparedSha256: expected, currentSha256 })
}
assert.deepEqual(postComparisonChanges.map(change => change.path).sort(), [
  'src/providers/model-cli.mjs', 'src/evaluation/provider-benchmark-runner.mjs',
  'src/evaluation/provider-comparison.mjs', 'scripts/benchmark-provider-comparison.mjs'].sort())
const logNames = { red: '/tmp/bth-v42-red.log', scoped: '/tmp/bth-v42-scoped.log', postreview: '/tmp/bth-v42-postreview.log',
  proofRed: '/tmp/bth-v42-native-proof-red.log', proofGreen: '/tmp/bth-v42-native-proof-green.log',
  shellProofRed: '/tmp/bth-v42-shell-proof-red.log', shellProofGreen: '/tmp/bth-v42-shell-proof-green.log',
  coverage: '/tmp/bth-v42-sealed-coverage.log', mutation: '/tmp/bth-v42-sealed-mutation.log', install: '/tmp/bth-v42-sealed-install.log' }
const logs = Object.fromEntries(await Promise.all(Object.entries(logNames).map(async ([key, path]) => [key, await readFile(path, 'utf8')])))
const suites = Object.fromEntries(['red', 'scoped', 'postreview', 'proofRed', 'proofGreen', 'shellProofRed', 'shellProofGreen', 'coverage'].map(key => [key, {
  logSha256: hash(logs[key]), ...Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(label => {
    const match = logs[key].match(new RegExp('^# ' + label + ' (\\d+)$', 'm'))
    assert.ok(match, key + '/' + label)
    return [label, +match[1]]
  }))
}]))
assert.equal(suites.red.fail, 3)
assert.equal(suites.scoped.fail, 0)
assert.equal(suites.postreview.fail, 0)
assert.equal(suites.proofRed.fail, 1)
assert.equal(suites.proofGreen.fail, 0)
assert.equal(suites.shellProofRed.fail, 1)
assert.equal(suites.shellProofGreen.fail, 0)
assert.equal(suites.coverage.fail, 0)
assert.equal(suites.coverage.skipped, 4)
const totals = logs.coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
assert.ok(totals)
const mutationsKilled = (logs.mutation.match(/^KILLED /gm) ?? []).length
assert.equal(mutationsKilled, 46)
assert.ok(logs.install.includes('Installed package smoke passed'))
execFileSync('git', ['diff', '--check'], { cwd: root })
execFileSync(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root })
const remainingResources = []
for (const label of ['bth.fastapi.productqa', 'bth.fastapi.oracle']) for (const kind of ['container', 'network']) {
  const args = kind === 'container' ? ['ps', '-a'] : ['network', 'ls']
  const ids = execFileSync('docker', [...args, '--filter', 'label=' + label, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
  assert.equal(ids, '')
  remainingResources.push({ label, kind, remaining: 0 })
}
const extraPaths = ['README.md', 'CHANGELOG.md', 'docs/evidence/native-workflow-v42.md', 'scripts/mutation-smoke.mjs',
  'docs/evidence/artifacts/v42/record-qa.mjs', 'docs/evidence/artifacts/v42/audit-native-validation.mjs',
  'src/providers/validation-activity.mjs', 'test/validation-activity.test.mjs',
  'test/workflow-budget.test.mjs', 'test/model-cli-provider.test.mjs', 'test/provider-comparison.test.mjs',
  'test/provider-benchmark-runner.test.mjs', 'test/provider-benchmark-script.test.mjs']
const sourceHashes = { ...pair.sourceHashes, ...Object.fromEntries(await Promise.all([...extraPaths, ...postComparisonChanges.map(change => change.path)].map(async path => [path, hash(await readFile(join(root, path)))]))) }
const auditRaw = await readFile(join(directory, 'native-validation-audit.json')), audit = JSON.parse(auditRaw)
assert.equal(audit.originalArtifactSha256, hash(pairRaw))
assert.equal(audit.nativePairConfirmed, false)
for (const [path, expected] of Object.entries(audit.sourceHashes)) assert.equal(sourceHashes[path], expected)
const artifact = { schemaVersion: 1, recordedAt: new Date().toISOString(), platform: process.platform, node: process.version,
  sourceHashes, suites, skippedTests: [...logs.coverage.matchAll(/^ok \d+ - (.+) # SKIP.*$/gm)].map(match => match[1]),
  coverage: { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4] },
  mutation: { killed: mutationsKilled, curatedTotal: 46, exhaustive: false, logSha256: hash(logs.mutation) },
  installSmoke: { passed: true, logSha256: hash(logs.install) }, syntaxPassed: true, diffCheckPassed: true,
  pairSha256: hash(pairRaw), auditSha256: hash(auditRaw), postComparisonChanges, remainingResources,
  postComparisonCorrection: 'Missing direct native validation now produces unknown completion. New observer and scoring were tested after the frozen actual pair, not run through another paid pair here.',
  goalComplete: false, goalGaps: ['Only one attempted native public task pair, whose direct self-validation is unconfirmed; no completed native pair claimed. 3 backends and 20 tasks are not completed.',
    'Native Claude full-workflow execution, actual Windows/MySQL and two-developer onboarding remain unverified here.',
    'Direct internal repair count is unknown, observed command events do not prove complete policy compliance.',
    'Approved decisions and prepared fixtures omit human interview time and unfamiliar company-policy correctness.'] }
await writeFile(join(directory, 'qa.json'), JSON.stringify(redactForShare(artifact).value, null, 2) + '\n')
console.log(JSON.stringify({ tests: suites.coverage, mutationsKilled, goalComplete: false }))
