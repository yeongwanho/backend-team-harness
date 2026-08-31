// Preserve historical evidence while applying the current native completion rule.
// This is a status index, not a new inference run or an aggregate speed experiment.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { scoreProviderCase } from '../../../../src/evaluation/provider-comparison.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const legacyBuilder = 'docs/evidence/artifacts/v35/rebuild-corpus-ledger.mjs'
const ledger = JSON.parse(execFileSync(process.execPath, [legacyBuilder], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
assert.equal(ledger.rows.length, 20)
const artifacts = new Map()
const snapshotPath = 'src/evaluation/isolated-git-snapshot.mjs'
const snapshotSha256 = hash(await readFile(join(root, snapshotPath)))
for (const row of ledger.rows) {
  const matched = []
  for (const entry of row.controlArtifacts) {
    const evidence = JSON.parse(await readFile(join(root, entry.artifact)))
    if (evidence.sourceHashes?.[snapshotPath] === snapshotSha256) matched.push(entry)
  }
  row.controlArtifacts = matched
  row.currentOracleControlsConfirmed = row.fixtureHashesMatch && matched.length > 0
  const task = corpus.repositories.flatMap(repository => repository.tasks).find(task => task.id === row.taskId)
  for (const run of row.runs.filter(run => run.protocol?.startsWith('native-workflow-'))) {
    if (!artifacts.has(run.artifact)) artifacts.set(run.artifact, await readFile(join(root, run.artifact)))
    const raw = artifacts.get(run.artifact)
    assert.equal(hash(raw), run.artifactSha256)
    const found = []
    function visit(value) {
      if (!value || typeof value !== 'object') return
      if (value.case?.taskId === row.taskId && value.case?.provider === run.provider && value.case?.lane === run.lane && value.observation) found.push(value)
      for (const child of Object.values(value)) visit(child)
    }
    visit(JSON.parse(raw))
    assert.equal(found.length, 1, 'Native case must be uniquely attributable to an original artifact')
    const record = found[0]
    assert.equal(record.case.baseSha, task.baseSha); assert.equal(record.case.targetSha, task.targetSha)
    assert.equal(record.case.requirementSha256, task.requirementSha256)
    const scored = scoreProviderCase(task, record.observation)
    run.originalSuccessAt1 = run.successAt1
    run.successAt1 = scored.successAt1
    run.failureReasons = scored.failureReasons
    run.nativeValidationConfirmed = scored.nativeValidationConfirmed
    run.successUnit = scored.successUnit
    run.statusRecomputedFromOriginalObservation = true
  }
  row.pairs = row.pairs.map(pair => {
    const entries = row.runs.filter(run => run.artifact === pair.artifact && run.provider === pair.provider && run.modelInferenceObserved)
    const bth = entries.find(run => run.lane === 'bth'), direct = entries.find(run => run.lane === 'direct')
    const native = Boolean(bth?.protocol?.startsWith('native-workflow-') && direct?.protocol === bth.protocol)
    return { ...pair, successUnit: native ? 'workflow-request' : 'provider-invocation',
      bothSuccessAt1: bth?.successAt1 === true && direct?.successAt1 === true }
  })
  row.historicalSuccessfulPair = row.pairs.some(pair => pair.bothSuccessAt1)
  row.nativeMeasuredInferencePair = row.pairs.some(pair => pair.successUnit === 'workflow-request')
  const nativeRuns = row.runs.filter(run => run.protocol?.startsWith('native-workflow-'))
  row.nativePairAttempted = nativeRuns.some(run => nativeRuns.some(other => other.artifact === run.artifact &&
    other.provider === run.provider && other.lane !== run.lane))
  row.nativePairConfirmed = row.pairs.some(pair => pair.successUnit === 'workflow-request' && pair.bothSuccessAt1)
}
ledger.counts.tasksWithHistoricalSuccessfulPair = ledger.rows.filter(row => row.historicalSuccessfulPair).length
ledger.counts.currentValidatedOracles = ledger.rows.filter(row => row.currentOracleControlsConfirmed).length
ledger.snapshotHelperSha256 = snapshotSha256
ledger.counts.tasksWithNativePairAttempt = ledger.rows.filter(row => row.nativePairAttempted).length
ledger.counts.tasksWithConfirmedNativePair = ledger.rows.filter(row => row.nativePairConfirmed).length
ledger.schemaVersion = 2
ledger.goalComplete = false
ledger.statusRecordedAt = new Date().toISOString()
ledger.statusBuilder = { legacyBuilderSha256: hash(await readFile(join(root, legacyBuilder))),
  nativeScorerSha256: hash(await readFile(join(root, 'src/evaluation/provider-comparison.mjs'))),
  builderSha256: hash(await readFile(fileURLToPath(import.meta.url))) }
ledger.limitations.push('Native historical observations are re-scored separately; their saved raw scores are not overwritten.',
  'Native pair attempts include paired CLI records even when one interrupted CLI reports no usage; this is not proof of fully measured inference.',
  'Confirmed native pairs are scoped to their own recorded runtime/protocol, not proof that every task passes on the current product.',
  'Corpus status does not prove company interview correctness, actual Windows, MySQL corpus tasks, or two-developer handoff.')
await writeFile(join(directory, 'corpus-ledger.json'), JSON.stringify(redactForShare(ledger).value, null, 2) + '\n')
console.log(JSON.stringify({ counts: ledger.counts, goalComplete: false,
  native: ledger.rows.filter(row => row.nativePairAttempted).map(row => ({ task: row.taskId, confirmed: row.nativePairConfirmed })) }))
