import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const names = ['codex-native-spring-pair.json', 'spring-baseline.json', 'direct-diagnostic.json', 'corpus-ledger.json']
const artifacts = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(join(directory, name))])))
const pair = JSON.parse(artifacts[names[0]]), baseline = JSON.parse(artifacts[names[1]]), diagnostic = JSON.parse(artifacts[names[2]]), ledger = JSON.parse(artifacts[names[3]])
for (const [path, expected] of Object.entries(pair.sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
assert.equal(pair.nativePairConfirmed, false)
assert.equal(pair.records.bth.score.successAt1, true)
assert.equal(pair.records.direct.score.successAt1, false)
assert.equal(pair.records.direct.score.usage.tokens.total, null)
assert.equal(pair.integrity.bth.lastVerification.sourceMatches, true)
assert.equal(pair.records.bth.observation.evidence.verificationTests.executed, 71)
assert.equal(baseline.record.acceptanceControls.controlsConfirmed, true)
assert.equal(diagnostic.originalCandidateUnchanged, true)
assert.equal(diagnostic.verification.tests.executed, 72)
assert.equal(diagnostic.acceptance.candidatePassed, true)
assert.equal(ledger.counts.tasks, 20)
assert.equal(ledger.counts.tasksWithNativePairAttempt, 3)
assert.equal(ledger.counts.tasksWithConfirmedNativePair, 1)
const coverage = await readFile('/tmp/bth-v44-coverage-final.log', 'utf8')
const suite = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(key => {
  const match = coverage.match(new RegExp('^# ' + key + ' (\\d+)$', 'm')); assert.ok(match); return [key, +match[1]]
}))
assert.deepEqual(suite, { tests: 620, pass: 616, fail: 0, skipped: 4 })
const totals = coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
assert.ok(totals)
const mutation = await readFile('/tmp/bth-v44-mutation.log', 'utf8'), install = await readFile('/tmp/bth-v44-install.log', 'utf8')
assert.equal((mutation.match(/^KILLED /gm) ?? []).length, 50)
assert.ok(install.includes('Installed package smoke passed'))
execFileSync(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root })
execFileSync('git', ['diff', '--check'], { cwd: root })
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
const paths = [...new Set([...Object.keys(pair.sourceHashes), ...changed, ...added])].filter(path => path && !/^docs\/evidence\/artifacts\/v44\/.*\.json$/.test(path))
const sourceHashes = Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, hash(await readFile(join(root, path)))])))
const invalidated = await readFile('/tmp/bth-v44-coverage.log', 'utf8')
assert.ok(invalidated.includes('ENOSPC'))
await writeFile(join(directory, 'qa.json'), JSON.stringify(redactForShare({ schemaVersion: 1,
  recordedAt: new Date().toISOString(), platform: process.platform, node: process.version, sourceHashes,
  suite, coverage: { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4], logSha256: hash(coverage) },
  mutation: { killed: 50, curatedTotal: 50, exhaustive: false, logSha256: hash(mutation) },
  install: { passed: true, logSha256: hash(install) }, syntaxPassed: true, diffCheckPassed: true,
  artifactHashes: Object.fromEntries(names.map(name => [name, hash(artifacts[name])])), corpusCounts: ledger.counts,
  invalidatedCoverage: { reason: 'ENOSPC during concurrent full-history acceptance clones', logSha256: hash(invalidated), countedAsPass: false },
  commands: ['node --test test/isolated-git-snapshot.test.mjs test/task-acceptance.test.mjs test/public-maven-fixture.test.mjs test/public-maven-cleanup.test.mjs test/windows-compat.test.mjs',
    'node node_modules/c8/bin/c8.js --all --include=src/**/*.mjs --check-coverage --lines 88 --branches 77 --functions 90 --reporter=text node --test --test-concurrency=4 test/*.test.mjs',
    'node scripts/mutation-smoke.mjs', 'node scripts/install-smoke.mjs',
    'BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS node scripts/benchmark-provider-comparison.mjs --execute --workflow native-workflow --provider codex --lane both --task spring-02-owner-search-whitespace --mode fast --model gpt-5.6-sol --timeout-ms 240000 --max-attempts 3 --allow-network --keep-workspace --output <new-directory>'],
  goalComplete: false,
  limitations: ['Prepared public project, not zero-configuration company onboarding or validated interview accuracy.',
    'Direct CLI exited before final usage/completion. Its separate diagnostic pass is not native workflow success.',
    'Only one historically confirmed native pair; no twenty-task completeness or general speed/token advantage.',
    'Actual Windows provider/descendant termination, two-developer handoff and company-policy integration remain unverified.',
    'Depth-one snapshot optimizes Git object copying; current-source acceptance controls require reruns for other tasks.',
    'Default suite skips four opt-in environmental tests. Real Spring JVM/DB evidence is separate; no OS egress guarantee.']
}).value, null, 2) + '\n')
console.log(JSON.stringify({ suite, mutationsKilled: 50, corpusCounts: ledger.counts, goalComplete: false }))
