#!/usr/bin/env node

// Plan-only experiment. Never installs dependencies, calls a provider or runs a
// project gate. The legacy query is intentionally preserved as the control.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { indexProjectGraph } from '../packs/codegraph-advisory/indexer.mjs'
import { rankCodeContext } from '../src/core/code-context.mjs'
import { buildSafeEnvironment } from '../src/core/process-runner.mjs'
import { selectTaskRetrievalQuery } from '../src/core/retrieval-query.mjs'
import { loadInterview } from '../src/core/interview-store.mjs'
import { loadEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../src/evaluation/provider-benchmark-config.mjs'
import { aggregateLocalization, scoreLocalization } from '../src/evaluation/metrics.mjs'
import { initProject } from '../src/init-project.mjs'
import { runWork } from '../src/runtime/work-orchestrator.mjs'

const execute = promisify(execFile)
const budgetCharacters = 2000
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function argumentsFor(argv) {
  const result = { cache: null, output: null }
  for (let index = 0; index < argv.length; index += 1) {
    if (!['--cache', '--output'].includes(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Expected --cache <existing-public-mirrors> --output <new-json-file>.')
    }
    const key = argv[index].slice(2)
    if (result[key] !== null) throw new Error('Duplicate option: ' + argv[index])
    result[key] = resolve(argv[++index])
  }
  if (!result.cache || !result.output) throw new Error('--cache and --output are required; no network fetch is performed.')
  return result
}

async function git(args, cwd) {
  const result = await execute('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: 30000, env: { ...buildSafeEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' }
  })
  return result.stdout.trim()
}

function ranking(graph, task, query) {
  const result = rankCodeContext(graph, query, { budgetCharacters })
  const paths = result.entries.map((entry) => entry.path)
  return {
    ...scoreLocalization(task, paths),
    querySha256: sha256(query), queryCharacters: query.length,
    budget: result.budget, paths, matchedTokens: result.query.matchedTokens
  }
}

async function evaluateTask(root, mirror, repository, repositoryConfig, task) {
  const workspace = join(root, task.id)
  await git(['clone', '--quiet', '--no-checkout', '--no-hardlinks', mirror, workspace])
  const parent = await git(['rev-parse', task.targetSha + '^'], workspace)
  const gold = (await git(['diff', '--no-renames', '--name-only', task.baseSha, task.targetSha, '--'], workspace))
    .split(/\r?\n/).filter(Boolean).sort()
  if (parent !== task.baseSha || JSON.stringify(gold) !== JSON.stringify(task.goldPaths)) {
    throw new Error('Pinned parent or filename gold mismatch: ' + task.id)
  }
  await git(['checkout', '--quiet', '--detach', task.baseSha], workspace)
  await initProject(workspace, { preferredSystem: repositoryConfig.buildSystem })
  const planned = await runWork(workspace, {
    taskId: 'QUERY-CONTROL', actor: 'retrieval-benchmark', requirement: task.requirement,
    decisions: repositoryConfig.tasks.find((entry) => entry.id === task.id).decisions
  })
  const common = {
    repositoryId: repository.id, taskId: task.id, requirementSha256: task.requirementSha256,
    baseSha: task.baseSha, targetSha: task.targetSha, planStatus: planned.status
  }
  if (!planned.task) return { ...common, evaluated: false, reason: 'plan-not-materialized' }
  const interview = await loadInterview(workspace, planned.task.id)
  const graph = await indexProjectGraph(workspace, { generatedAt: '1970-01-01T00:00:00.000Z' })
  const legacy = [planned.task.title, planned.task.context, planned.task.plan]
    .filter((value) => typeof value === 'string').join('\n').slice(0, 64 * 1024)
  return {
    ...common, evaluated: true,
    planning: {
      schemaStrategy: planned.draft?.draft?.schemaStrategy ?? null,
      dataClaims: interview.artifacts.plan.structuredDecisions.data,
      migrations: interview.contextSnapshot.migrations ?? null
    },
    graph: { generation: graph.graph.generation, nodes: graph.metrics.nodes, edges: graph.metrics.edges },
    legacy: ranking(graph, task, legacy),
    requirementOnly: ranking(graph, task, task.requirement),
    selected: ranking(graph, task, selectTaskRetrievalQuery(planned.task, interview.record.requirement))
  }
}

async function main() {
  const options = argumentsFor(process.argv.slice(2))
  const corpus = await loadEvaluationCorpus(resolve('benchmarks/public-backend-v1/corpus.json'))
  const config = await loadProviderBenchmarkConfig(resolve('benchmarks/public-backend-v1/provider-comparison.json'), corpus)
  const sourceCommit = await git(['rev-parse', 'HEAD'], process.cwd())
  const sourceFiles = [
    'src/core/code-context.mjs', 'src/core/lexical-retrieval.mjs',
    'packs/codegraph-advisory/indexer.mjs',
    'src/core/retrieval-query.mjs', 'src/runtime/implementation-orchestrator.mjs',
    'src/runtime/plan-export.mjs', 'scripts/benchmark-retrieval-query.mjs',
    'src/core/migration-discovery.mjs', 'src/core/work-draft.mjs', 'src/core/interview-state.mjs',
    'src/adapters/project-context.mjs', 'src/adapters/project-intelligence.mjs',
    'src/runtime/work-orchestrator.mjs', 'src/runtime/interview-orchestrator.mjs'
  ]
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (path) => [path, sha256(await readFile(path))])))
  const scratch = await mkdtemp(join(tmpdir(), 'bth-query-control-'))
  const tasks = []
  const started = Date.now()
  try {
    for (const repository of corpus.repositories) {
      const mirror = join(options.cache, repository.id + '.git')
      if (await git(['config', '--get', 'remote.origin.url'], mirror) !== repository.url) {
        throw new Error('Public mirror origin does not match corpus: ' + repository.id)
      }
      const repositoryConfig = config.repositories.find((entry) => entry.id === repository.id)
      for (const task of repository.tasks) {
        // Do not hide failed preparation in an aggregate of only passing cases.
        try { tasks.push(await evaluateTask(scratch, mirror, repository, repositoryConfig, task)) }
        catch (error) { tasks.push({ repositoryId: repository.id, taskId: task.id, evaluated: false, reason: String(error.message).slice(0, 2000) }) }
        process.stdout.write(JSON.stringify({ taskId: task.id, evaluated: tasks.at(-1).evaluated }) + '\n')
      }
    }
    const evaluated = tasks.filter((task) => task.evaluated)
    const result = {
      schemaVersion: 1, evaluation: 'same-graph-budget-plan-query-control',
      authority: 'static-advisory-not-implementation-success', sourceCommit, sourceHashes,
      corpusSha256: corpus.sourceSha256, configSha256: config.sourceSha256,
      budgetCharacters, durationMs: Date.now() - started,
      taskCount: tasks.length, evaluatedCount: evaluated.length,
      aggregate: {
        legacy: aggregateLocalization(evaluated.map((task) => task.legacy)),
        requirementOnly: aggregateLocalization(evaluated.map((task) => task.requirementOnly)),
        selected: aggregateLocalization(evaluated.map((task) => task.selected))
      }, tasks
    }
    await writeFile(options.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    process.stdout.write(JSON.stringify({ output: options.output, evaluated: evaluated.length, total: tasks.length, aggregate: result.aggregate }) + '\n')
    if (evaluated.length !== tasks.length) process.exitCode = 1
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
