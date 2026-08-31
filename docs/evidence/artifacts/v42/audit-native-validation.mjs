// Re-score saved observations, never rerun or rewrite the original model pair.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreProviderCase } from '../../../../src/evaluation/provider-comparison.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const raw = await readFile(join(directory, 'codex-native-pair.json')), original = JSON.parse(raw)
const hash = value => createHash('sha256').update(value).digest('hex')
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const task = corpus.repositories.flatMap(repository => repository.tasks).find(task => task.id === original.taskId)
const scores = Object.fromEntries(Object.entries(original.records).map(([lane, record]) => [lane, scoreProviderCase(task, record.observation)]))
assert.equal(scores.bth.successAt1, true)
assert.equal(scores.direct.taskAcceptanceSuccess, true)
assert.equal(scores.direct.successAt1, null)
assert.equal(scores.direct.nativeValidationConfirmed, null)
const sourcePaths = ['src/evaluation/provider-comparison.mjs', 'src/evaluation/provider-benchmark-runner.mjs',
  'src/providers/model-cli.mjs', 'src/providers/validation-activity.mjs', 'scripts/benchmark-provider-comparison.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
await writeFile(join(directory, 'native-validation-audit.json'), JSON.stringify({ schemaVersion: 1,
  kind: 'saved-observation-rescore-not-new-inference', recordedAt: new Date().toISOString(), originalArtifactSha256: hash(raw), sourceHashes,
  scores, goalComplete: false, nativePairConfirmed: false,
  finding: 'Both candidates passed evaluator tests, but direct self-validation execution was unobserved. The raw original true score is not accepted as native workflow completion.',
  limitations: ['No new model invocation and no source change in either candidate.',
    'Cannot distinguish skipped validation from missed tracing in the original direct run.',
    'The new observer recognizes equivalent path spelling and explicit tool completion; this does not retroactively recover missing events.',
    'Command events are advisory, not OS isolation or proof that a successful earlier command covers the final edited source. Final evaluator verification remains required.']
}, null, 2) + '\n')
console.log(JSON.stringify({ bth: scores.bth.successAt1, direct: scores.direct.successAt1, nativePairConfirmed: false }))
