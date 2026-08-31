// Freeze source before real calls; later record terminal public-task artifacts.
// seal <new-seal.json> | record <seal.json> <output-dir> <preflight.json>
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { loadTask } from '../../../../src/core/task-store.mjs'
import { snapshotImplementedFiles } from '../../../../src/core/implementation-record-store.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'
import { verificationInputPaths } from '../../../../src/config/verification.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const [mode, sealPath, output, preflightPath] = process.argv.slice(2)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const paths = ['src/providers/model-cli.mjs', 'src/core/provider-context.mjs', 'packs/codegraph-advisory/indexer.mjs',
  'src/core/code-context.mjs', 'src/evaluation/task-acceptance.mjs', 'src/evaluation/provider-benchmark-runner.mjs',
  'src/runtime/implementation-orchestrator.mjs', 'src/runtime/work-orchestrator.mjs',
  'scripts/benchmark-provider-comparison.mjs', 'benchmarks/public-backend-v1/provider-comparison.json']
if (!sealPath || !['seal', 'record'].includes(mode)) throw new Error('Explicit seal or record inputs required.')
const currentHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(root, path)))])))
if (mode === 'seal') {
  await writeFile(resolve(sealPath), JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(),
    sourceParent: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes: currentHashes }, null, 2) + '\n', { flag: 'wx' })
  console.log('Sealed source before provider execution.')
} else {
  if (!output || !preflightPath) throw new Error('Output and baseline preflight required.')
  const seal = JSON.parse(await readFile(resolve(sealPath)))
  assert.deepEqual(currentHashes, seal.sourceHashes, 'Source changed since pre-execution seal.')
  const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
  const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
  const taskId = 'fastapi-04-constant-time-login'
  const task = config.repositories.find(repository => repository.id === 'fastapi-template').tasks.find(task => task.id === taskId)
  const preflight = JSON.parse(await readFile(resolve(preflightPath)))
  assert.equal(preflight.readyForProviderComparison, true)
  assert.equal(preflight.preflight.tests.executed, 62)
  function cases(bytes) {
    const found = []
    function visit(node) {
      if (!node || typeof node !== 'object') return
      for (const [key, child] of Object.entries(node)) {
        if (key === 'testcase') for (const entry of [].concat(child)) found.push(String(entry['@_classname']) + '::' + String(entry['@_name']))
        else if (!key.startsWith('@_')) for (const value of [].concat(child)) visit(value)
      }
    }
    visit(new XMLParser({ ignoreAttributes: false }).parse(bytes.toString('utf8')))
    return found.sort()
  }
  const reportPath = '.backend-harness/local/reports/tests/junit.xml'
  const baseReport = await readFile(join(preflight.workspace, reportPath)), baseCases = cases(baseReport)
  assert.equal(new Set(baseCases).size, 62)
  const records = {}, integrity = {}
  for (const lane of ['bth', 'direct']) {
    const raw = await readFile(join(resolve(output), 'codex', lane, taskId + '.json')), record = JSON.parse(raw)
    assert.equal(record.case.taskId, taskId)
    assert.equal(record.case.provider, 'codex')
    assert.equal(record.case.lane, lane)
    assert.equal(record.fairness.configSha256, config.sourceSha256)
    assert.equal(record.fairness.protocolVersion, 'bounded-navigation-v41')
    records[lane] = { originalArtifactSha256: hash(raw), ...record }
    if (!record.observation || !record.workspace) { integrity[lane] = { checked: false }; continue }
    let candidate = record.workspace, providerInvocation = null, requestMetrics = null
    if (lane === 'bth') {
      const id = 'BENCH-' + hash(taskId).slice(0, 16).toUpperCase()
      const implementation = JSON.parse(await readFile(join(record.workspace, '.backend-harness/local/implementation', id + '.json')))
      candidate = implementation.workspace
      const invocation = implementation.attempts?.[0]?.invocation
      if (invocation) providerInvocation = { version: invocation.version, model: invocation.model, profile: invocation.profile, usage: invocation.usage }
      const requestRaw = await readFile(join(candidate, '.backend-harness/local/implementation/request-' + id + '.json'))
      const request = JSON.parse(requestRaw), original = await loadTask(record.workspace, id)
      assert.equal(request.task.approvedPlan, original.record.plan)
      requestMetrics = { sha256: hash(requestRaw), bytes: requestRaw.length,
        entries: request.codeContext.entries.map(entry => entry.path), budget: request.codeContext.budget,
        declaredRules: request.projectConventions.projectRules.rules.length,
        approvedPlanUnchanged: true, sectionsBytes: Object.fromEntries(Object.entries(request).map(([key, value]) => [key, Buffer.byteLength(JSON.stringify(value))])) }
    }
    const fixture = await inspectProjectFixture(candidate, task.projectFixture)
    const protectedInputs = await snapshotImplementedFiles(candidate, [...new Set([
      ...verificationInputPaths(task.projectFixture.verification).map(path => path.replace(/^\.\//, '')), '.backend-harness/verification.json'
    ])].sort())
    const current = await captureConfiguredSourceBinding(candidate)
    const runRaw = await readFile(join(candidate, '.backend-harness/local/runs/latest.json')), run = JSON.parse(runRaw)
    const report = await readFile(join(candidate, reportPath)), finalCases = cases(report)
    const testEvidence = { runRecordSha256: hash(runRaw), reportSha256: hash(report),
      sourceMatchesLastRun: current.fingerprint === run.postSourceFingerprint, originalTests: baseCases.length, finalTests: finalCases.length,
      missingBaselineCases: baseCases.filter(entry => !finalCases.includes(entry)), addedCases: finalCases.filter(entry => !baseCases.includes(entry)) }
    if (record.observation.verificationConfirmed) assert.ok(testEvidence.sourceMatchesLastRun && fixture.valid)
    integrity[lane] = { fixture, protectedInputs, providerInvocation, requestMetrics, testEvidence,
      finalSourceFingerprint: current.fingerprint, changedFiles: await snapshotImplementedFiles(candidate, record.observation.changedPaths) }
  }
  assert.equal(records.bth.fairness.fixedModel, records.direct.fairness.fixedModel)
  assert.deepEqual(integrity.bth.protectedInputs, integrity.direct.protectedInputs)
  await writeFile(join(directory, 'codex-pair.json'), JSON.stringify(redactForShare({
    schemaVersion: 1, kind: 'actual-provider-pair', recordedAt: new Date().toISOString(), sourceSeal: seal,
    sourceHashes: currentHashes, taskId, provider: 'codex', model: records.bth.fairness.fixedModel,
    mode: 'deep', effort: 'high', order: ['bth', 'direct'], attemptsPerLane: 1,
    records, integrity: { preliminaryBaselineReportSha256: hash(baseReport), sameProtectedInputsAcrossLanes: true, candidates: integrity },
    limitations: ['Controlled one-call editing comparison, not native provider full-workflow baseline or aggregate superiority.',
      'Navigation and policy-control metrics are partial observations, not proof of semantic completeness or all project conventions.',
      'Direct CLI version is not persisted by the runner; missing cost remains unknown. Total tokens include cache reuse.',
      'No manual candidate repair or application; published scores preserve their original outcomes.']
  }).value, null, 2) + '\n', { flag: 'wx' })
  console.log('Recorded the terminal pair without rewriting original scores.')
}
