#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { indexProjectGraph } from '../packs/codegraph-advisory/indexer.mjs'
import { rankCodeContext } from '../src/core/code-context.mjs'
import { loadEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { aggregateLocalization, scoreLocalization } from '../src/evaluation/metrics.mjs'

const execute = promisify(execFile)

function argumentsFor(argv) {
  const result = { corpus: 'benchmarks/public-backend-v1/corpus.json', output: null, allowNetwork: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--allow-network') result.allowNetwork = true
    else if (value === '--corpus') result.corpus = argv[++index]
    else if (value === '--output') result.output = argv[++index]
    else throw new Error('Unknown argument: ' + value)
  }
  if (!result.allowNetwork) throw new Error('Public corpus evaluation clones pinned repositories and requires --allow-network.')
  return result
}

async function git(args, cwd = undefined) {
  const result = await execute('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return result.stdout.trim()
}

async function verifyTaskGold(repositoryRoot, task) {
  const parent = await git(['rev-parse', task.targetSha + '^'], repositoryRoot)
  if (parent !== task.baseSha) throw new Error(task.id + ': baseSha is not the direct parent of targetSha.')
  const observed = (await git(['diff', '--no-renames', '--name-only', task.baseSha, task.targetSha, '--'], repositoryRoot))
    .split(/\r?\n/).filter(Boolean).sort()
  if (JSON.stringify(observed) !== JSON.stringify(task.goldPaths)) {
    throw new Error(task.id + ': goldPaths do not match the pinned Git diff.')
  }
}

async function evaluateRepository(repository, root) {
  const repositoryRoot = resolve(root, repository.id)
  await git(['clone', '--filter=blob:none', '--no-checkout', '--quiet', repository.url, repositoryRoot])
  const tasks = []
  for (const task of repository.tasks) {
    try {
      await verifyTaskGold(repositoryRoot, task)
      await git(['checkout', '--detach', '--force', '--quiet', task.baseSha], repositoryRoot)
      const graph = await indexProjectGraph(repositoryRoot, { generatedAt: '1970-01-01T00:00:00.000Z' })
      const ranking = rankCodeContext(graph, task.requirement, { budgetCharacters: 100_000 })
      const rankedPaths = ranking.entries.map((entry) => entry.path)
      const score = scoreLocalization(task, rankedPaths)
      tasks.push({
        ...score,
        requirementSha256: task.requirementSha256,
        baseSha: task.baseSha,
        targetSha: task.targetSha,
        graph: { nodes: graph.metrics.nodes, edges: graph.metrics.edges },
        rankingTop20: rankedPaths.slice(0, 20),
        goldPositions: Object.fromEntries(task.goldPaths.map((path) => {
          const position = rankedPaths.indexOf(path)
          return [path, position === -1 ? null : position + 1]
        })),
        query: ranking.query,
        algorithm: ranking.algorithm
      })
    } catch (error) {
      throw new Error(repository.id + '/' + task.id + ': ' + error.message, { cause: error })
    }
  }
  return {
    id: repository.id,
    language: repository.language,
    url: repository.url,
    license: repository.license,
    aggregate: aggregateLocalization(tasks),
    tasks
  }
}

async function main() {
  const options = argumentsFor(process.argv.slice(2))
  const corpus = await loadEvaluationCorpus(resolve(options.corpus))
  const scratch = await mkdtemp(resolve(tmpdir(), 'bth-public-evaluation-'))
  const startedAt = Date.now()
  try {
    const repositories = []
    for (const repository of corpus.repositories) repositories.push(await evaluateRepository(repository, scratch))
    const tasks = repositories.flatMap((repository) => repository.tasks)
    const report = {
      schemaVersion: 1,
      corpus: { id: corpus.id, sha256: corpus.sourceSha256, repositoryCount: corpus.repositoryCount, taskCount: corpus.taskCount },
      evaluation: 'source-bound-static-impact-localization',
      authority: 'benchmark-observation-not-verdict',
      durationMs: Date.now() - startedAt,
      aggregate: aggregateLocalization(tasks),
      repositories
    }
    const text = JSON.stringify(report, null, 2) + '\n'
    if (options.output) {
      const output = resolve(options.output)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, text, { encoding: 'utf8', flag: 'wx' })
    } else {
      process.stdout.write(text)
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

await main()
