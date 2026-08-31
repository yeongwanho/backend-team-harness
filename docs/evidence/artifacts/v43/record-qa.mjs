import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const pairRaw = await readFile(join(directory, 'codex-native-small-pair.json')), pair = JSON.parse(pairRaw)
assert.equal(pair.nativePairConfirmed, true)
for (const [path, expected] of Object.entries(pair.sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, path)
assert.deepEqual(pair.integrity.bth.changedFiles, pair.integrity.direct.changedFiles)
for (const lane of ['bth', 'direct']) {
  assert.equal(pair.records[lane].score.successAt1, true)
  assert.equal(pair.records[lane].observation.evidence.verificationTests.executed, 58)
  assert.equal(pair.records[lane].observation.acceptance.candidate.cases.length, 7)
  assert.ok(pair.integrity[lane].lastVerification.sourceMatches)
}
const logPaths = { owner: '/tmp/bth-v43-mysql-owner-green.log', mysql: '/tmp/bth-v43-mysql-real.log',
  coverage: '/tmp/bth-v43-coverage.log', mutation: '/tmp/bth-v43-mutation.log', install: '/tmp/bth-v43-install.log' }
const logs = Object.fromEntries(await Promise.all(Object.entries(logPaths).map(async ([key, path]) => [key, await readFile(path, 'utf8')])))
const suites = Object.fromEntries(['owner', 'mysql', 'coverage'].map(key => [key, {
  logSha256: hash(logs[key]), ...Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map(label => {
    const match = logs[key].match(new RegExp('^# ' + label + ' (\\d+)$', 'm'))
    assert.ok(match, key + '/' + label)
    return [label, +match[1]]
  }))
}]))
for (const suite of Object.values(suites)) { assert.equal(suite.fail, 0); assert.ok(suite.pass > 0) }
assert.equal(suites.owner.pass, 2); assert.equal(suites.mysql.pass, 1); assert.equal(suites.mysql.skipped, 0)
assert.equal(suites.coverage.skipped, 4)
const mysql = JSON.parse(logs.mysql.match(/^# BTH_REAL_MYSQL_EVIDENCE (\{.*\})$/m)?.[1] ?? 'null')
assert.deepEqual(mysql.observations.map(entry => entry.mode), ['success', 'assertion-failure', 'process-failure', 'timeout'])
assert.deepEqual(mysql.observations.map(entry => entry.confirmed), [true, false, false, false])
assert.equal(mysql.observations[0].executed, 1)
assert.deepEqual(mysql.observations.slice(1).map(entry => entry.reason), ['process_failed', 'process_failed', 'process_timed_out'])
assert.ok(mysql.observations.every(entry => entry.ownerResourcesRemaining === 0))
const totals = logs.coverage.match(/^All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/m)
assert.ok(totals)
const killed = (logs.mutation.match(/^KILLED /gm) ?? []).length
assert.equal(killed, 48)
assert.ok(logs.install.includes('Installed package smoke passed'))
execFileSync(process.execPath, ['scripts/check-syntax.mjs'], { cwd: root })
execFileSync('git', ['diff', '--check'], { cwd: root })
const extraPaths = ['README.md', 'CHANGELOG.md', 'docs/PACKS.md', 'docs/evidence/native-small-work-v43.md',
  'examples/spring-service/README.md', 'examples/spring-service/build.gradle.kts',
  'examples/spring-service/src/integrationTest/java/com/example/orders/MySqlMigrationIntegrationTest.java',
  'examples/spring-service/src/main/resources/db/migration/V1__create_orders.sql',
  'test/db-real-e2e.test.mjs', 'test/owned-docker-resources.test.mjs', 'test-support/owned-docker-resources.mjs',
  'scripts/mutation-smoke.mjs', 'docs/evidence/artifacts/v43/rebuild-progress.mjs', 'docs/evidence/artifacts/v43/record-qa.mjs']
const sourceHashes = { ...pair.sourceHashes, ...Object.fromEntries(await Promise.all(extraPaths.map(async path => [path, hash(await readFile(join(root, path)))]))) }
const ledgerRaw = await readFile(join(directory, 'corpus-ledger.json')), ledger = JSON.parse(ledgerRaw)
assert.equal(ledger.counts.tasks, 20); assert.equal(ledger.counts.tasksWithConfirmedNativePair, 1)
await writeFile(join(directory, 'qa.json'), JSON.stringify(redactForShare({ schemaVersion: 1, recordedAt: new Date().toISOString(),
  platform: process.platform, node: process.version, sourceHashes, suites,
  coverage: { statements: +totals[1], branches: +totals[2], functions: +totals[3], lines: +totals[4] },
  mysql, mutation: { killed, curatedTotal: 48, exhaustive: false, logSha256: hash(logs.mutation) },
  syntaxPassed: true, diffCheckPassed: true, installSmoke: { passed: true, logSha256: hash(logs.install) },
  pairSha256: hash(pairRaw), ledgerSha256: hash(ledgerRaw), corpusCounts: ledger.counts,
  commands: ['BTH_PROVIDER_BENCHMARK=I_UNDERSTAND_PROVIDER_COSTS node scripts/benchmark-provider-comparison.mjs --execute --workflow native-workflow --provider codex --lane both --task fastapi-05-missing-user --mode fast --model gpt-5.6-sol --timeout-ms 240000 --max-attempts 3 --allow-network --keep-workspace --output <new-directory>',
    'BTH_REAL_DB_E2E=1 node --test test/db-real-e2e.test.mjs', 'npm run test:coverage',
    'node scripts/mutation-smoke.mjs', 'node scripts/install-smoke.mjs'],
  goalComplete: false,
  limitations: ['Reference fixture/test cleanup changed; production BTH implementation runtime is unchanged from 3249d9e.',
    'Only one confirmed small-task native Codex pair. No native Claude, full 20-task success or universal efficiency claim.',
    'Actual MySQL reference E2E passed separately; it is opt-in and remains skipped in the default coverage run.',
    'Actual Windows provider/descendant tests and separate Maven/Gradle E2E were not executed here.',
    'Direct content-read telemetry covers supported commands only and is not equivalent to BTH supplied-context ranking.',
    'Company policy/interview correctness, two-developer handoff, real MySQL corpus tasks and candidate integration remain unproved.']
}).value, null, 2) + '\n')
console.log(JSON.stringify({ tests: suites.coverage, mysql: suites.mysql, mutationsKilled: killed, goalComplete: false }))
