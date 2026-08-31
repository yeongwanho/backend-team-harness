// Post-run diagnostic only: never updates the original provider score or candidate.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createIsolatedGitSnapshot } from '../../../../src/evaluation/isolated-git-snapshot.mjs'
import { captureConfiguredSourceBinding, checkProject } from '../../../../src/runtime/backend-harness.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { evaluateTaskAcceptance } from '../../../../src/evaluation/task-acceptance.mjs'
import { resolveSafeProjectPath } from '../../../../src/fs-safety.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../../../..')
const hash = value => createHash('sha256').update(value).digest('hex')
const originalRaw = await readFile('/tmp/bth-v44-native-codex/codex/direct/spring-02-owner-search-whitespace.json')
const original = JSON.parse(originalRaw), pair = JSON.parse(await readFile(join(directory, 'codex-native-spring-pair.json')))
assert.equal(hash(originalRaw), pair.records.direct.originalArtifactSha256)
const before = await captureConfiguredSourceBinding(original.workspace)
assert.equal(before.fingerprint, pair.integrity.direct.finalSourceFingerprint)
const allocation = await mkdtemp(join(tmpdir(), 'bth-v44-direct-diagnostic-')), candidate = join(allocation, 'candidate')
try {
  const head = execFileSync('git', ['-C', original.workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  await createIsolatedGitSnapshot(original.workspace, head, candidate)
  for (const path of original.observation.changedPaths) {
    assert.ok(path.startsWith('src/'))
    await copyFile(await resolveSafeProjectPath(original.workspace, path), await resolveSafeProjectPath(candidate, path))
  }
  const checked = await checkProject(candidate, { allowNetwork: true })
  const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
  const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
  const task = corpus.repositories[0].tasks.find(t => t.id === original.case.taskId)
  const acceptance = checked.confirmed ? await evaluateTaskAcceptance({
    mirror: '/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git', task,
    acceptance: config.repositories[0].tasks.find(t => t.id === task.id).acceptance,
    fixtureRoot: join(root, 'benchmarks/public-backend-v1'), candidateRoot: candidate, timeoutMs: 240000
  }) : null
  assert.equal((await captureConfiguredSourceBinding(original.workspace)).fingerprint, before.fingerprint)
  const paths = ['src/evaluation/isolated-git-snapshot.mjs', 'src/evaluation/task-acceptance.mjs', 'docs/evidence/artifacts/v44/diagnose-direct.mjs']
  await writeFile(join(directory, 'direct-diagnostic.json'), JSON.stringify(redactForShare({
    schemaVersion: 1, kind: 'isolated-post-run-diagnostic-not-provider-success', recordedAt: new Date().toISOString(),
    originalArtifactSha256: hash(originalRaw), originalScoreUnchanged: original.score.successAt1,
    sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path, hash(await readFile(join(root, path)))]))),
    originalCandidateUnchanged: true, originalSourceFingerprint: before.fingerprint,
    verification: { confirmed: checked.confirmed, tests: checked.result?.tests, failure: checked.result?.failure?.code ?? null },
    acceptance, goalComplete: false,
    limitations: ['A fresh evaluator-only run cannot retroactively complete the interrupted provider session or recover missing usage.',
      'No model re-invocation and no manual correction of the provider code. This time is excluded from the original score.']
  }).value, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ confirmed: checked.confirmed, tests: checked.result?.tests, acceptance: acceptance?.candidatePassed }))
} finally { await rm(allocation, { recursive: true, force: true }) }
