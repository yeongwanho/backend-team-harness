// Freeze before inference. Collect terminal observations without changing scores.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { snapshotImplementedFiles } from '../../../../src/core/implementation-record-store.mjs'
import { verificationInputPaths } from '../../../../src/config/verification.mjs'
import { inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const [mode, sealPath, output] = process.argv.slice(2)
const hash = value => createHash('sha256').update(value).digest('hex')
const sourcePaths = [...execFileSync('git', ['ls-files', 'src', 'packs'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(path => /\.(mjs|json)$/.test(path)), 'benchmarks/public-backend-v1/fixtures/spring/PetAssociationAcceptanceTests.java', 'src/providers/model-cli.mjs', 'src/providers/validation-activity.mjs',
  'src/evaluation/workflow-budget.mjs', 'src/evaluation/provider-benchmark-runner.mjs',
  'src/evaluation/provider-comparison.mjs', 'src/evaluation/task-acceptance.mjs', 'src/evaluation/isolated-git-snapshot.mjs',
  'src/runtime/implementation-orchestrator.mjs', 'src/runtime/work-orchestrator.mjs',
  'src/core/provider-context.mjs', 'packs/codegraph-advisory/indexer.mjs',
  'scripts/benchmark-provider-comparison.mjs', 'benchmarks/public-backend-v1/corpus.json',
  'benchmarks/public-backend-v1/provider-comparison.json', 'docs/evidence/artifacts/v46/record-pair.mjs', 'src/core/platform.mjs',
  ...['BthDatabaseFixture.java', 'MySqlIntegrationTests.java', 'MysqlTestApplication.java', 'PostgresIntegrationTests.java',
    'full-test-run.mjs', 'verify-public-maven', 'verify-public-maven.cmd'].map(name => 'benchmarks/public-backend-v1/fixtures/spring/' + name)]
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
if (!['seal', 'record'].includes(mode) || !sealPath) throw new Error('seal <new-seal.json> or record <seal.json> <output-directory> required.')
if (mode === 'seal') {
  await writeFile(resolve(sealPath), JSON.stringify({ schemaVersion: 1, sourceHashes, createdAt: new Date().toISOString(),
    sourceParent: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }, null, 2) + '\n', { flag: 'wx' })
  console.log('Sealed source before inference.')
} else {
  if (!output) throw new Error('Output directory required.')
  const seal = JSON.parse(await readFile(resolve(sealPath)))
  assert.deepEqual(sourceHashes, seal.sourceHashes, 'Source changed since model execution was planned.')
  const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
  const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
  const taskId = 'spring-01-pet-association', provider = 'codex'
  const fixture = config.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === taskId).projectFixture
  const records = {}, integrity = {}
  for (const lane of ['bth', 'direct']) {
    const raw = await readFile(join(resolve(output), provider, lane, taskId + '.json')), record = JSON.parse(raw)
    assert.equal(record.case.taskId, taskId); assert.equal(record.case.provider, provider); assert.equal(record.case.lane, lane)
    assert.equal(record.fairness.protocolVersion, 'native-workflow-v42-observed-validation')
    assert.equal(record.fairness.configSha256, config.sourceSha256)
    assert.equal(record.fairness.fixedMode, 'fast'); assert.equal(record.fairness.fixedModel, 'gpt-5.6-sol')
    assert.equal(record.score.successUnit, 'workflow-request')
    records[lane] = { originalArtifactSha256: hash(raw), ...record }
    if (!record.observation || !record.workspace) { integrity[lane] = { checked: false }; continue }
    let candidate = record.workspace, implementation = null
    if (lane === 'bth') {
      const id = 'BENCH-' + hash(taskId).slice(0, 16).toUpperCase()
      try { implementation = JSON.parse(await readFile(join(record.workspace, '.backend-harness/local/implementation', id + '.json'))) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      candidate = implementation?.workspace
    }
    if (!candidate) { integrity[lane] = { checked: false, reason: 'No implementation candidate' }; continue }
    const current = await captureConfiguredSourceBinding(candidate)
    let lastVerification = null
    try {
      const rawRun = await readFile(join(candidate, '.backend-harness/local/runs/latest.json'))
      const run = JSON.parse(rawRun)
      lastVerification = { sha256: hash(rawRun), sourceMatches: current.fingerprint === run.postSourceFingerprint }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const protectedInputs = await snapshotImplementedFiles(candidate, [...new Set([
      ...verificationInputPaths(fixture.verification).map(path => path.replace(/^\.\//, '')), '.backend-harness/verification.json'
    ])].sort())
    const fixtureIntegrity = await inspectProjectFixture(candidate, fixture)
    if (record.observation.verificationConfirmed) assert.ok(lastVerification?.sourceMatches && fixtureIntegrity.valid)
    integrity[lane] = { checked: true, candidate, finalSourceFingerprint: current.fingerprint, lastVerification,
      fixture: fixtureIntegrity, protectedInputs, changedFiles: await snapshotImplementedFiles(candidate, record.observation.changedPaths),
      attempts: implementation?.attempts?.map(attempt => ({ number: attempt.attempt, outcome: attempt.outcome,
        process: { exitCode: attempt.adapter.exitCode, timedOut: attempt.adapter.timedOut }, invocation: attempt.invocation })) ?? null }
  }
  assert.equal(records.bth.fairness.executionPolicySha256, records.direct.fairness.executionPolicySha256)
  if (integrity.bth.checked && integrity.direct.checked) assert.deepEqual(integrity.bth.protectedInputs, integrity.direct.protectedInputs)
  await writeFile(join(directory, 'codex-native-spring-pair.json'), JSON.stringify(redactForShare({ schemaVersion: 1,
    kind: 'actual-native-workflow-pair', recordedAt: new Date().toISOString(), sourceHashes, seal,
    taskId, provider, mode: 'fast', effort: 'low', order: ['bth', 'direct'], records, integrity,
    nativePairConfirmed: ['bth', 'direct'].every(lane => records[lane].score.successAt1 === true), goalComplete: false,
    limitations: ['One Spring task with prepared immutable test provisioning; not zero-configuration onboarding, aggregate superiority or company-policy/interview validation.',
      'Preserves original failed and unknown outcomes; no manual provider candidate repair or application.',
      'Success unit is a workflow request. Controlled-edit results cannot be pooled with this experiment.',
      'Tool observations are not OS isolation or proof about every final-source test or shell operation.',
      'Direct internal repairs and Codex dollar cost remain unknown; total tokens include cache input.']
  }).value, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(Object.fromEntries(Object.entries(records).map(([lane, record]) => [lane, {
    successAt1: record.score.successAt1, taskAcceptanceSuccess: record.score.taskAcceptanceSuccess,
    elapsedMs: record.score.elapsedMs, totalTokens: record.score.usage.tokens.total, reasons: record.score.failureReasons }]))))
}
