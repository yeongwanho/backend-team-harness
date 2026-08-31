import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const load = path => import(pathToFileURL(join(repo, path)))
const { loadEvaluationCorpus } = await load('src/evaluation/corpus.mjs')
const { loadProviderBenchmarkConfig } = await load('src/evaluation/provider-benchmark-config.mjs')
const { runPreparedComparisonCase } = await load('src/evaluation/provider-benchmark-runner.mjs')
const { implementationStatus } = await load('src/runtime/implementation-orchestrator.mjs')
const { applyImplementation } = await load('src/runtime/implementation-apply.mjs')
const { checkProject } = await load('src/runtime/backend-harness.mjs')
const { redactForShare } = await load('src/core/redaction.mjs')
const { buildSafeEnvironment } = await load('src/core/process-runner.mjs')
const corpus = await loadEvaluationCorpus(join(repo, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(repo, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const task = corpus.repositories.find(r => r.id === 'spring-petclinic').tasks.find(t => t.id === 'spring-01-pet-association')
const repositoryConfig = config.repositories.find(r => r.id === 'spring-petclinic')
const mirror = resolve(process.argv[2] ?? '/tmp/bth-provider-comparison-cache-v2/spring-petclinic.git')
const owned = await mkdtemp(join(tmpdir(), 'bth-v37-authorized-replay-'))
const root = join(owned, 'project')
const git = (args, cwd = owned) => execFileSync('git', args, { cwd, env: buildSafeEnvironment(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
git(['clone', '--shared', '--no-checkout', '--quiet', mirror, root])
git(['checkout', '--quiet', '--detach', task.baseSha], root)
const paths = git(['--git-dir=' + mirror, 'diff', '--name-only', task.baseSha, task.targetSha]).trim().split('\n')
if (paths.some(path => !path.startsWith('src/') || path.includes('..'))) throw new Error('Unexpected target paths.')
let fixtureCalls = 0
const result = await runPreparedComparisonCase(root, task, repositoryConfig, {
  provider: 'codex', lane: 'bth', mode: 'fast', model: null, maxAttempts: 1, timeoutMs: 180000, maxBudgetUsd: null
}, {
  providerProbe: async () => ({ available: true, version: 'deterministic-historical-replay-not-a-model' }),
  bthProviderRunner: async (_adapter, input) => {
    fixtureCalls++
    for (const path of paths) {
      await mkdir(dirname(join(input.cwd, path)), { recursive: true })
      await writeFile(join(input.cwd, path), git(['--git-dir=' + mirror, 'show', task.targetSha + ':' + path]))
    }
    return { process: { exitCode: 0, signal: null, timedOut: false, stdioDrainTimedOut: false,
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0,
      stdout: { sha256: 'a'.repeat(64), bytes: 0, tail: '' }, stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' } },
      metadata: { kind: 'provider', provider: 'codex', version: 'fixture', profile: input.profile, usage: {} } }
  }
})
const taskId = 'BENCH-' + createHash('sha256').update(task.id).digest('hex').slice(0, 16).toUpperCase()
const status = await implementationStatus(root, taskId)
let applyWithoutReview = null, applied = null, integratedTests = null
try { await applyImplementation(root, taskId, { actor: 'regression-fixture', allowWrite: true }) }
catch (error) { applyWithoutReview = error.code }
if (result.observation.verificationConfirmed && status.preservationReview?.status === 'required') {
  applied = await applyImplementation(root, taskId, { actor: 'regression-fixture', allowWrite: true,
    acceptPreservationReview: status.preservationReview.fingerprint,
    reviewNote: 'Replaying the known historical association requirement in a disposable regression clone.' })
  const checked = await checkProject(root, { allowNetwork: true })
  integratedTests = { confirmed: checked.confirmed, tests: checked.result?.tests }
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sourceHashes = Object.fromEntries(await Promise.all(['src/runtime/implementation-orchestrator.mjs', 'src/runtime/implementation-apply.mjs', 'src/core/preservation-review.mjs'].map(async path => [path, hash(await readFile(join(repo, path)))])))
console.log(JSON.stringify(redactForShare({ schemaVersion: 1, kind: 'public-java-historical-target-replay-not-model-evaluation',
  taskId: task.id, baseSha: task.baseSha, targetSha: task.targetSha, sourceHashes, providerCalls: 0, fixtureCalls,
  observation: result.observation, review: status.preservationReview, applyWithoutReview,
  applied: applied ? { integrated: applied.integration.integrated, receipt: applied.receipt } : null,
  integratedTests, isolatedTestRoot: root, productionOrCompanyWrites: false,
  limitation: 'Known target replay proves runtime behavior, not autonomous implementation quality or success@1.' }).value, null, 2))
if (fixtureCalls !== 1 || applyWithoutReview !== 'apply_preservation_review_required' || !applied?.integration.integrated || !integratedTests?.confirmed) process.exitCode = 1
