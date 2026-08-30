#!/usr/bin/env node
// Model-free pinned public controls. Preparation stays offline inside the test
// fixtures; this command never installs providers or changes authentication.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../src/evaluation/provider-benchmark-config.mjs'
import { evaluateTaskAcceptance } from '../src/evaluation/task-acceptance.mjs'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'
import { redactString } from '../src/core/redaction.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
function parse(argv) {
  const options = { cache: null, output: null, tasks: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i], value = argv[++i]
    if (!['--cache', '--output', '--task'].includes(key) || !value || value.startsWith('--')) throw new Error('Expected --cache PATH --output NEW_JSON --task ID (repeatable).')
    if (key === '--task') {
      if (!/^[a-z][a-z0-9-]{2,95}$/.test(value) || options.tasks.includes(value)) throw new Error('Invalid or duplicate task.')
      options.tasks.push(value)
    } else {
      if (options[key.slice(2)]) throw new Error('Duplicate option: ' + key)
      options[key.slice(2)] = resolve(value)
    }
  }
  if (!options.cache || !options.output || !options.tasks.length) throw new Error('--cache, --output and at least one --task are required.')
  return options
}
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...buildSafeEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } }).trim()
}
const options = parse(process.argv.slice(2))
if (await lstat(options.output).catch(error => { if (error.code === 'ENOENT') return null; throw error })) throw new Error('Output already exists; use a new JSON path.')
const corpus = await loadEvaluationCorpus(join(root, 'benchmarks/public-backend-v1/corpus.json'))
const fixtureRoot = join(root, 'benchmarks/public-backend-v1')
const config = await loadProviderBenchmarkConfig(join(fixtureRoot, 'provider-comparison.json'), corpus)
const selections = options.tasks.map(id => {
  const repository = corpus.repositories.find(repository => repository.tasks.some(task => task.id === id))
  const task = repository?.tasks.find(task => task.id === id)
  const acceptance = config.repositories.find(entry => entry.id === repository?.id)?.tasks.find(task => task.id === id)?.acceptance
  if (!task || !acceptance) throw new Error('No independent acceptance is configured for ' + id)
  return { repository, task, acceptance }
})
const results = []
for (const { repository, task, acceptance } of selections) {
  const mirror = join(options.cache, repository.id + '.git')
  if (git(mirror, ['config', '--get', 'remote.origin.url']) !== repository.url) throw new Error('Public mirror origin mismatch.')
  if (git(mirror, ['rev-parse', task.targetSha + '^']) !== task.baseSha) throw new Error('Pinned parent mismatch.')
  const gold = git(mirror, ['diff', '--no-renames', '--name-only', task.baseSha, task.targetSha, '--']).split(/\r?\n/).filter(Boolean).sort()
  if (JSON.stringify(gold) !== JSON.stringify(task.goldPaths)) throw new Error('Pinned filename gold mismatch.')
  process.stdout.write(JSON.stringify({ taskId: task.id, phase: 'controls-started' }) + '\n')
  let result
  try {
    result = await evaluateTaskAcceptance({ mirror, task, acceptance, fixtureRoot, timeoutMs: 180000 }, {
      processRunner: async input => {
        const execution = await runProcess(input)
        if (execution.exitCode !== 0) {
          // Diagnostic tails are local stderr only, never the shared result.
          process.stderr.write(redactString(execution.stderr.tail.slice(-12000), { projectRoot: input.cwd }).value + '\n')
        }
        return execution
      }
    })
  } catch (error) {
    result = { controlsConfirmed: false, reason: 'control-execution-error', diagnostic: redactString(String(error.message)).value.slice(0, 2000) }
  }
  results.push({ repositoryId: repository.id, taskId: task.id, requirementSha256: task.requirementSha256,
    baseSha: task.baseSha, targetSha: task.targetSha, result })
  process.stdout.write(JSON.stringify({ taskId: task.id, controlsConfirmed: result.controlsConfirmed, reason: result.reason }) + '\n')
}
const sourcePaths = ['src/evaluation/task-acceptance.mjs', 'src/evaluation/provider-benchmark-config.mjs', 'src/core/junit.mjs', 'scripts/acceptance-controls.mjs']
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(join(root, path)))])))
const confirmed = results.filter(entry => entry.result.controlsConfirmed).length
await writeFile(options.output, JSON.stringify({
  schemaVersion: 1, kind: 'public-base-target-behavior-controls', providerCalls: 0,
  sourceCommit: git(root, ['rev-parse', 'HEAD']), sourceHashes,
  corpusSha256: corpus.sourceSha256, configSha256: config.sourceSha256,
  taskCount: results.length, controlsConfirmed: confirmed, node: process.version, platform: process.platform, results
}, null, 2) + '\n', { flag: 'wx' })
process.stdout.write(JSON.stringify({ output: options.output, controlsConfirmed: confirmed, total: results.length }) + '\n')
if (confirmed !== results.length) process.exitCode = 1
