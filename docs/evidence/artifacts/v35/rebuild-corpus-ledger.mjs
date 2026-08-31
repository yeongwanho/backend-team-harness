import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const load = path => import(pathToFileURL(join(root, path)))
const { loadEvaluationCorpus } = await load('src/evaluation/corpus.mjs')
const { loadProviderBenchmarkConfig } = await load('src/evaluation/provider-benchmark-config.mjs')
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const evaluatorPath = 'src/evaluation/task-acceptance.mjs'
const evaluatorSha256 = hash(await readFile(join(root, evaluatorPath)))
const artifacts = []
async function walk(directory) {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (path.endsWith('.json') && !path.endsWith('/corpus-ledger.json')) {
      const bytes = await readFile(join(root, path))
      artifacts.push({ path, sha256: hash(bytes), data: JSON.parse(bytes) })
    }
  }
}
await walk('docs/evidence/artifacts')
const rows = []
for (const repository of corpus.repositories) for (const task of repository.tasks) {
  const acceptance = config.repositories.find(r => r.id === repository.id).tasks.find(t => t.id === task.id).acceptance
  const oracleSha256 = acceptance ? hash(JSON.stringify({ oracle: acceptance, base: task.baseSha, target: task.targetSha })) : null
  const fixtureHashesMatch = acceptance?.kind === 'fixture-tests'
    ? (await Promise.all(acceptance.files.map(async file => hash(await readFile(join(root, 'benchmarks/public-backend-v1', file.fixture))) === file.sha256))).every(Boolean)
    : acceptance !== null
  const controls = [], runs = []
  for (const artifact of artifacts) {
    const matches = []
    let control = false
    const evaluatorMatches = (artifact.data.sourceHashes?.[evaluatorPath] ?? artifact.data.sourceSha256?.[evaluatorPath]) === evaluatorSha256
    function inspect(value) {
      if (!value || typeof value !== 'object') return
      if (oracleSha256 && value.oracleSha256 === oracleSha256 && value.controlsConfirmed === true &&
          value.controls?.base?.regressionReproduced === true && value.controls?.target?.passed === true) control = true
      if (value.case?.taskId === task.id && value.score && value.observation) matches.push(value)
      for (const child of Object.values(value)) inspect(child)
    }
    inspect(artifact.data)
    if (control && evaluatorMatches) controls.push({ artifact: artifact.path, sha256: artifact.sha256 })
    for (const record of matches) {
      const tokens = record.observation.usage?.tokens ?? record.score.usage?.tokens
      runs.push({ artifact: artifact.path, artifactSha256: artifact.sha256, provider: record.case.provider,
        lane: record.case.lane, protocol: record.fairness?.protocolVersion ?? artifact.data.protocolVersion ?? null,
        modelInferenceObserved: typeof tokens?.input === 'number' && tokens.input > 0,
        cliAttempts: record.observation.attempts ?? record.score.attempts ?? null,
        successAt1: record.score.successAt1, failureReasons: record.score.failureReasons })
    }
  }
  const pairs = []
  for (const key of new Set(runs.map(run => run.artifact + '|' + run.provider))) {
    const entries = runs.filter(run => run.artifact + '|' + run.provider === key)
    const bth = entries.find(run => run.lane === 'bth' && run.modelInferenceObserved)
    const direct = entries.find(run => run.lane === 'direct' && run.modelInferenceObserved)
    if (bth && direct) pairs.push({ artifact: bth.artifact, provider: bth.provider,
      bothSuccessAt1: bth.successAt1 === true && direct.successAt1 === true })
  }
  rows.push({ taskId: task.id, repositoryId: repository.id, baseSha: task.baseSha, targetSha: task.targetSha,
    oracleConfigured: acceptance !== null, fixtureHashesMatch, oracleSha256, currentOracleControlsConfirmed: fixtureHashesMatch && controls.length > 0,
    controlArtifacts: controls, runs, historicalPairedInference: pairs.length > 0,
    historicalSuccessfulPair: pairs.some(pair => pair.bothSuccessAt1), pairs })
}
console.log(JSON.stringify({ schemaVersion: 1, kind: 'source-matched-corpus-evidence-ledger',
  corpusSha256: corpus.sourceSha256, configSha256: config.sourceSha256, evaluatorSha256, rows,
  counts: { tasks: rows.length, configuredOracles: rows.filter(r => r.oracleConfigured).length,
    currentValidatedOracles: rows.filter(r => r.currentOracleControlsConfirmed).length,
    tasksWithHistoricalPairedInference: rows.filter(r => r.historicalPairedInference).length,
    tasksWithHistoricalSuccessfulPair: rows.filter(r => r.historicalSuccessfulPair).length },
  limitations: ['Historical pairs across different protocols are not a pooled success-rate or speed experiment.',
    'Zero-token quota refusals are CLI attempts, not model inference.',
    'Only saved case+observation+score records are counted as pairs; recovery diagnostics and single-lane replays are excluded.',
    'Validated oracle means exact current normalized oracle hash and pinned base/target controls match; fixture presence alone is insufficient.'] }, null, 2))

