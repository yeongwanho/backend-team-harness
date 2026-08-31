// No model, build, dependency installation or network fetch. Each public clone
// belongs to this invocation and is released before the next pinned task.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { indexProjectGraph } from '../../../../packs/codegraph-advisory/indexer.mjs'
import { rankCodeContext } from '../../../../src/core/code-context.mjs'
import { selectProviderContext } from '../../../../src/core/provider-context.mjs'
import { buildProjectConventions } from '../../../../src/core/project-conventions.mjs'
import { selectTaskRetrievalQuery } from '../../../../src/core/retrieval-query.mjs'
import { buildSafeEnvironment } from '../../../../src/core/process-runner.mjs'
import { loadInterview } from '../../../../src/core/interview-store.mjs'
import { loadEvaluationCorpus } from '../../../../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../../../../src/evaluation/provider-benchmark-config.mjs'
import { aggregateLocalization, scoreLocalization } from '../../../../src/evaluation/metrics.mjs'
import { initProject } from '../../../../src/init-project.mjs'
import { runWork } from '../../../../src/runtime/work-orchestrator.mjs'
import { generatedProviderContext } from '../../../../src/runtime/interview-orchestrator.mjs'
import { redactForShare } from '../../../../src/core/redaction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const [cacheArg, outputArg] = process.argv.slice(2)
if (!cacheArg || !outputArg) throw new Error('Usage: compare-navigation.mjs <existing-public-mirror-cache> <new-output.json>')
const cache = resolve(cacheArg), output = resolve(outputArg), baselineCommit = '7fb29f02a14b7bf4e6738309680e1c1d89617128'
const execute = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex')
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const profiles = { fast: 2000, balanced: 6000, deep: 12000 }
async function git(args, cwd = root) {
  return (await execute('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
    env: { ...buildSafeEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } })).stdout.trim()
}
const sourcePaths = ['packs/codegraph-advisory/indexer.mjs', 'src/core/provider-context.mjs',
  'src/core/code-context.mjs', 'src/core/lexical-retrieval.mjs', 'src/core/project-conventions.mjs',
  'src/core/retrieval-query.mjs', 'src/runtime/interview-orchestrator.mjs',
  'docs/evidence/artifacts/v41/compare-navigation.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const config = await loadProviderBenchmarkConfig(join(root, 'benchmarks/public-backend-v1/provider-comparison.json'), corpus)
const scratch = await mkdtemp(join(tmpdir(), 'bth-navigation-v41-')), rows = []
const started = Date.now()
let baselineHashes
try {
  baselineHashes = {}
  for (const [path, name] of [['packs/codegraph-advisory/indexer.mjs', 'old-indexer.mjs'], ['src/core/provider-context.mjs', 'old-projection.mjs']]) {
    const source = (await execute('git', ['show', baselineCommit + ':' + path], { cwd: root, maxBuffer: 1024 * 1024 })).stdout
    baselineHashes[path] = hash(source)
    await writeFile(join(scratch, name), source, { flag: 'wx' })
  }
  const oldIndexer = (await import(pathToFileURL(join(scratch, 'old-indexer.mjs')))).indexProjectGraph
  const oldProjection = (await import(pathToFileURL(join(scratch, 'old-projection.mjs')))).selectProviderContext
  for (const repository of corpus.repositories) {
    const mirror = join(cache, repository.id + '.git')
    assert.equal(await git(['config', '--get', 'remote.origin.url'], mirror), repository.url)
    const repositoryConfig = config.repositories.find(entry => entry.id === repository.id)
    for (const task of repository.tasks) {
      const workspace = join(scratch, task.id)
      const common = { taskId: task.id, repositoryId: repository.id, baseSha: task.baseSha,
        targetSha: task.targetSha, requirementSha256: task.requirementSha256 }
      try {
        await git(['clone', '--quiet', '--no-checkout', '--no-hardlinks', mirror, workspace])
        assert.equal(await git(['rev-parse', task.targetSha + '^'], workspace), task.baseSha)
        const gold = (await git(['diff', '--no-renames', '--name-only', task.baseSha, task.targetSha, '--'], workspace)).split(/\r?\n/).filter(Boolean).sort()
        assert.deepEqual(gold, task.goldPaths)
        await git(['checkout', '--quiet', '--detach', task.baseSha], workspace)
        await initProject(workspace, { preferredSystem: repositoryConfig.buildSystem })
        const planned = await runWork(workspace, { taskId: 'NAVIGATION-CONTROL', actor: 'navigation-evaluator',
          requirement: task.requirement, decisions: repositoryConfig.tasks.find(entry => entry.id === task.id).decisions })
        if (!planned.task) throw new Error('Plan not materialized: ' + planned.status)
        const interview = await loadInterview(workspace, planned.task.id)
        const intelligence = interview.contextSnapshot.intelligence
        const modules = (intelligence.conventions?.modules ?? []).filter(module => module !== 'root')
        const projectPath = modules.length === 1 ? modules[0] : '.'
        const options = { projectPath, generatedAt: '1970-01-01T00:00:00.000Z' }
        const beforeGraph = await oldIndexer(workspace, options), afterGraph = await indexProjectGraph(workspace, options)
        const query = selectTaskRetrievalQuery(planned.task, interview.record.requirement)
        const payload = { id: planned.task.id, title: planned.task.title, context: generatedProviderContext(planned.task, interview), approvedPlan: planned.task.plan }
        const modes = {}
        for (const [mode, budgetCharacters] of Object.entries(profiles)) {
          const project = (graph, projection) => {
            const context = rankCodeContext(graph, query, { budgetCharacters })
            context.provenance = { mode: 'bounded-read-only-source-snapshot', graphGeneration: graph.graph.generation,
              sourceFingerprint: interview.contextSnapshot.sourceBinding.fingerprint, persisted: false }
            const conventions = buildProjectConventions(interview.artifacts.plan.projectRuleEvaluation, intelligence.knowledge, context, intelligence.conventions)
            const selected = projection(context, conventions, mode)
            return { selected, measurement: { ...scoreLocalization(task, selected.codeContext.entries.map(entry => entry.path)),
              paths: selected.codeContext.entries.map(entry => entry.path), contextBytes: bytes(selected),
              withApprovedTaskBytes: bytes({ task: payload, ...selected }), budget: selected.codeContext.budget } }
          }
          const before = project(beforeGraph, oldProjection), after = project(afterGraph, selectProviderContext)
          // Do not buy size savings by changing the project's supplied policy or
          // claiming complete runtime knowledge from a smaller navigation list.
          for (const key of ['projectRules', 'knowledgeDocuments', 'requiredBeforeEdit', 'authority']) {
            assert.deepEqual(after.selected.projectConventions[key], before.selected.projectConventions[key], key)
          }
          assert.deepEqual(after.selected.projectConventions.discovered.database.reviewCandidates, before.selected.projectConventions.discovered.database.reviewCandidates)
          assert.deepEqual(after.selected.codeContext.authority, before.selected.codeContext.authority)
          modes[mode] = { before: before.measurement, after: after.measurement, policyAndAuthorityUnchanged: true }
        }
        rows.push({ ...common, evaluated: true, projectPath, planStatus: planned.status, taskPayloadSha256: hash(JSON.stringify(payload)),
          graphs: { before: { generation: beforeGraph.graph.generation, tests: beforeGraph.metrics['edges.tests'] },
            after: { generation: afterGraph.graph.generation, tests: afterGraph.metrics['edges.tests'], ambiguousTestPaths: afterGraph.metrics.ambiguousTestPaths } }, modes })
      } catch (error) {
        rows.push({ ...common, evaluated: false, diagnostic: String(error.message).slice(0, 2000) })
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
      console.log(JSON.stringify({ taskId: task.id, evaluated: rows.at(-1).evaluated }))
    }
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}
for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(join(root, path))), expected, 'Source changed during experiment: ' + path)
const evaluated = rows.filter(row => row.evaluated)
const aggregate = Object.fromEntries(Object.keys(profiles).map(mode => [mode, Object.fromEntries(['before', 'after'].map(variant => [variant,
  evaluated.length ? { ...aggregateLocalization(evaluated.map(row => row.modes[mode][variant])),
    totalContextBytes: evaluated.reduce((sum, row) => sum + row.modes[mode][variant].contextBytes, 0) } : null]))]))
await writeFile(output, JSON.stringify(redactForShare({ schemaVersion: 1, kind: 'source-matched-static-navigation-control',
  baselineCommit, baselineHashes, sourceHashes, corpusSha256: corpus.sourceSha256, configSha256: config.sourceSha256,
  taskCount: rows.length, evaluatedCount: evaluated.length, durationMs: Date.now() - started, aggregate, rows,
  limitations: ['Static filename-gold localization and serialized context bytes, not provider success or token/time savings.',
    'Known 20-task corpus, not unseen held-out tasks. Per-task regressions remain in rows.',
    'Task/approved plan and supplied project rules preserved; navigation is not complete semantic impact analysis.',
    'No project gates, dependency installation, inference or candidate application executed.'] }).value, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ evaluated: evaluated.length, total: rows.length, aggregate }))
if (evaluated.length !== rows.length) process.exitCode = 1
