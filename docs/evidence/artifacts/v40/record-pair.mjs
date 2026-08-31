// Read finished public-project runs only. No inference, test execution or source edits.
// node record-pair.mjs <codex|claude> <raw-output-dir> <preflight-record.json>
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { inspectProjectFixture } from '../../../../src/evaluation/project-fixture.mjs'
import { captureConfiguredSourceBinding } from '../../../../src/runtime/backend-harness.mjs'
import { snapshotImplementedFiles } from '../../../../src/core/implementation-record-store.mjs'
import { verificationInputPaths } from '../../../../src/config/verification.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const [provider, output, preflightPath] = process.argv.slice(2)
if (!['codex', 'claude'].includes(provider) || !output || !preflightPath) throw new Error('Explicit provider/output/preflight required.')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const taskId = 'fastapi-04-constant-time-login'
const coreCommit = 'b188df307224ba2d91ba9da7ef058fea6d79811a'
const sourcePaths = ['scripts/benchmark-provider-comparison.mjs', 'src/evaluation/task-acceptance.mjs',
  'src/evaluation/provider-benchmark-runner.mjs', 'src/runtime/implementation-orchestrator.mjs',
  'src/runtime/work-orchestrator.mjs', 'src/providers/model-cli.mjs', 'src/core/implementation-verification.mjs',
  'src/core/test-failure-diagnostics.mjs', 'src/core/junit.mjs']
const sourceHashes = {}
for (const path of sourcePaths) {
  const bytes = await readFile(join(root, path))
  if (hash(bytes) !== hash(execFileSync('git', ['show', coreCommit + ':' + path], { cwd: root }))) throw new Error('Runtime changed: ' + path)
  sourceHashes[path] = hash(bytes)
}
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const task = config.repositories.find(repository => repository.id === 'fastapi-template').tasks.find(task => task.id === taskId)
const preflight = JSON.parse(await readFile(resolve(preflightPath)))
if (preflight.taskId !== taskId || !preflight.readyForProviderComparison || preflight.preflight?.tests?.executed !== 62) throw new Error('Expected preliminary 62-test baseline missing.')
const reportPath = '.backend-harness/local/reports/tests/junit.xml'
function cases(bytes) {
  const document = new XMLParser({ ignoreAttributes: false }).parse(bytes.toString('utf8'))
  const result = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node)) {
      if (key === 'testcase') for (const test of [].concat(child)) result.push(String(test['@_classname']) + '::' + String(test['@_name']))
      else if (!key.startsWith('@_')) for (const nested of [].concat(child)) visit(nested)
    }
  }
  visit(document)
  return result.sort()
}
const baseReport = await readFile(join(preflight.workspace, reportPath)), baseCases = cases(baseReport)
if (baseCases.length !== 62 || new Set(baseCases).size !== 62) throw new Error('Unexpected baseline test identity set.')
const records = {}, integrity = {}
for (const lane of ['bth', 'direct']) {
  const raw = await readFile(join(resolve(output), provider, lane, taskId + '.json')), record = JSON.parse(raw)
  if (record.case?.taskId !== taskId || record.case.provider !== provider || record.case.lane !== lane ||
      record.fairness?.configSha256 !== config.sourceSha256 || record.fairness.fixedMode !== 'deep') throw new Error('Pair input identity changed.')
  records[lane] = { originalArtifactSha256: hash(raw), ...record }
  if (!record.observation || !record.workspace) { integrity[lane] = { checked: false, reason: 'no-completed-provider-workspace' }; continue }
  let candidate = record.workspace, providerInvocation = null
  if (lane === 'bth') {
    const id = 'BENCH-' + hash(taskId).slice(0, 16).toUpperCase()
    const implementation = JSON.parse(await readFile(join(record.workspace, '.backend-harness/local/implementation', id + '.json')))
    candidate = implementation.workspace
    const invocation = implementation.attempts?.[0]?.invocation
    providerInvocation = invocation ? { version: invocation.version, model: invocation.model, profile: invocation.profile, usage: invocation.usage } : null
  }
  const fixture = await inspectProjectFixture(candidate, task.projectFixture)
  const protectedInputs = await snapshotImplementedFiles(candidate,
    [...new Set([...verificationInputPaths(task.projectFixture.verification).map(path => path.replace(/^\.\//, '')), '.backend-harness/verification.json'])].sort())
  const current = await captureConfiguredSourceBinding(candidate)
  let testEvidence = null
  try {
    const runBytes = await readFile(join(candidate, '.backend-harness/local/runs/latest.json'))
    const run = JSON.parse(runBytes), report = await readFile(join(candidate, reportPath)), finalCases = cases(report)
    testEvidence = { runRecordSha256: hash(runBytes), reportSha256: hash(report),
      sourceMatchesLastRun: current.fingerprint === run.postSourceFingerprint,
      originalTests: baseCases.length, finalTests: finalCases.length,
      missingBaselineCases: baseCases.filter(name => !finalCases.includes(name)),
      addedCases: finalCases.filter(name => !baseCases.includes(name)) }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (record.observation.verificationConfirmed && (!testEvidence?.sourceMatchesLastRun || !fixture.valid)) throw new Error('Claimed verification no longer matches retained candidate.')
  integrity[lane] = { fixture, protectedInputs, providerInvocation, finalSourceFingerprint: current.fingerprint,
    changedFiles: record.observation.changedPaths.length ? await snapshotImplementedFiles(candidate, record.observation.changedPaths) : [], testEvidence }
}
const sameProtectedInputsAcrossLanes = integrity.bth.protectedInputs && integrity.direct.protectedInputs
  ? JSON.stringify(integrity.bth.protectedInputs) === JSON.stringify(integrity.direct.protectedInputs) : null
if (records.bth.fairness.fixedModel !== records.direct.fairness.fixedModel) throw new Error('Pair models differ.')
const result = { schemaVersion: 1, kind: 'actual-provider-pair', recordedAt: new Date().toISOString(), taskId,
  runtime: { coreCommit, sourceCheckedAgainstCommit: true }, sourceHashes, configSha256: config.sourceSha256,
  provider, model: records.bth.fairness.fixedModel, mode: 'deep', effort: 'high', attemptsPerLane: 1,
  order: provider === 'codex' ? ['bth', 'direct'] : ['direct', 'bth'], records,
  integrity: { preliminaryBaselineReportSha256: hash(baseReport), sameProtectedInputsAcrossLanes, candidates: integrity },
  limitations: ['Controlled editing comparison: neither lane may run build/tests; evaluator owns both verification paths. This is not a native full-workflow baseline.',
    'One stochastic pair cannot establish aggregate superiority or speed/token savings.',
    'Rule counters are control-policy evidence, not proof of every project convention. Ranked BTH paths and observed direct pre-write reads are localization proxies, not a complete semantic impact graph.',
    'Total tokens include cache reuse; missing reported cost remains unknown. Claude final usage may omit auxiliary-model tokens; its original providerReported fields are retained.',
    'The BTH implementation record retains its CLI version. The controlled direct observation does not persist the version string from its successful CLI probe; do not infer an independently recorded direct version.',
    'No production writes or candidate application.'] }
await writeFile(join(directory, provider + '-pair.json'), JSON.stringify(redactForShare(result).value, null, 2) + '\n')
console.log('Recorded ' + provider + ' pair without changing either observed score.')
