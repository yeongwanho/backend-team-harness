// Seal source before inference, then preserve terminal public-workspace evidence.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { snapshotImplementedFiles } from '../../../../src/core/implementation-record-store.mjs'
import { verificationInputPaths } from '../../../../src/config/verification.mjs'
import { inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const [mode, sealPath, output, provider = 'codex'] = process.argv.slice(2)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const paths = ['src/providers/model-cli.mjs', 'src/evaluation/workflow-budget.mjs',
  'src/evaluation/provider-benchmark-runner.mjs', 'src/evaluation/provider-comparison.mjs',
  'src/runtime/implementation-orchestrator.mjs', 'src/runtime/work-orchestrator.mjs',
  'src/core/provider-context.mjs', 'packs/codegraph-advisory/indexer.mjs',
  'src/evaluation/task-acceptance.mjs', 'scripts/benchmark-provider-comparison.mjs',
  'benchmarks/public-backend-v1/provider-comparison.json', 'docs/evidence/artifacts/v42/record.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(root, path)))])))
if (!sealPath || !['seal', 'record'].includes(mode)) throw new Error('seal <new-seal.json> or record <seal.json> <output-directory> [provider]')
if (mode === 'seal') {
  await writeFile(resolve(sealPath), JSON.stringify({ sourceHashes, createdAt: new Date().toISOString(),
    sourceParent: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }, null, 2) + '\n', { flag: 'wx' })
  console.log('Sealed comparison source.')
} else {
  assert.ok(output)
  assert.ok(['codex', 'claude'].includes(provider))
  const seal = JSON.parse(await readFile(resolve(sealPath)))
  assert.deepEqual(sourceHashes, seal.sourceHashes)
  const taskId = 'fastapi-04-constant-time-login'
  const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
  const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
  const fixture = config.repositories.find(r => r.id === 'fastapi-template').tasks.find(t => t.id === taskId).projectFixture
  const records = {}, integrity = {}
  for (const lane of ['bth', 'direct']) {
    const raw = await readFile(join(resolve(output), provider, lane, taskId + '.json'))
    const record = JSON.parse(raw)
    assert.equal(record.case.taskId, taskId)
    assert.equal(record.case.provider, provider)
    assert.equal(record.case.lane, lane)
    assert.equal(record.fairness.protocolVersion, 'native-workflow-v42')
    assert.equal(record.fairness.configSha256, config.sourceSha256)
    assert.equal(record.score.successUnit, 'workflow-request')
    records[lane] = { originalArtifactSha256: hash(raw), ...record }
    if (!record.observation || !record.workspace) { integrity[lane] = { checked: false }; continue }
    let candidate = record.workspace, implementation = null
    if (lane === 'bth') {
      const id = 'BENCH-' + hash(taskId).slice(0, 16).toUpperCase()
      implementation = JSON.parse(await readFile(join(record.workspace, '.backend-harness/local/implementation', id + '.json')))
      candidate = implementation.workspace
    }
    const binding = await captureConfiguredSourceBinding(candidate)
    const protectedInputs = await snapshotImplementedFiles(candidate, [...new Set([
      ...verificationInputPaths(fixture.verification).map(path => path.replace(/^\.\//, '')), '.backend-harness/verification.json'
    ])].sort())
    let lastVerification = null
    try {
      const rawRun = await readFile(join(candidate, '.backend-harness/local/runs/latest.json'))
      const run = JSON.parse(rawRun)
      lastVerification = { sha256: hash(rawRun), sourceMatches: binding.fingerprint === run.postSourceFingerprint }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    integrity[lane] = { candidate, protectedInputs, fixture: await inspectProjectFixture(candidate, fixture),
      finalSourceFingerprint: binding.fingerprint, lastVerification,
      changedFiles: await snapshotImplementedFiles(candidate, record.observation.changedPaths),
      attempts: implementation?.attempts?.map(attempt => ({ number: attempt.attempt, outcome: attempt.outcome,
        process: { exitCode: attempt.adapter.exitCode, timedOut: attempt.adapter.timedOut }, invocation: attempt.invocation })) ?? null }
  }
  assert.equal(records.bth.fairness.executionPolicySha256, records.direct.fairness.executionPolicySha256)
  await writeFile(join(directory, provider + '-native-pair.json'), JSON.stringify(redactForShare({
    schemaVersion: 1, recordedAt: new Date().toISOString(), kind: 'actual-native-workflow-pair',
    sourceHashes, seal, taskId, provider, order: ['bth', 'direct'], records, integrity,
    limitations: ['One public task; not aggregate superiority or a held-out trial.',
      'success@1 is one top-level workflow request. Never pool with controlled-edit provider-invocation success.',
      'Direct internal repair count is unknown; model calls and validation-command events are separate measures.',
      'Prepared owned verification wrappers and restricted provider tools; not unrestricted personal CLI configuration.',
      'Provider time allowance excludes evaluator/harness gates; Codex has no dollar cap, unknown cost is not zero.',
      'No company source, production systems, user configuration or candidate integration was modified.']
  }).value, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(Object.fromEntries(Object.entries(records).map(([lane, record]) => [lane, record.score]))))
}
