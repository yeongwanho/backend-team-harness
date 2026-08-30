#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'
import { loadEvaluationCorpus } from '../src/evaluation/corpus.mjs'
import { loadProviderBenchmarkConfig } from '../src/evaluation/provider-benchmark-config.mjs'
import { runPreparedComparisonCase } from '../src/evaluation/provider-benchmark-runner.mjs'
import { buildComparisonMatrix, compareProviderLanes } from '../src/evaluation/provider-comparison.mjs'
import { probeImplementationProvider } from '../src/providers/model-cli.mjs'
import { initProject } from '../src/init-project.mjs'
import { checkProject } from '../src/runtime/backend-harness.mjs'

const execute = promisify(execFile)
const DEFAULT_CORPUS = 'benchmarks/public-backend-v1/corpus.json'
const DEFAULT_CONFIG = 'benchmarks/public-backend-v1/provider-comparison.json'
const EXECUTE_ACK = 'I_UNDERSTAND_PROVIDER_COSTS'
const ALL_ACK = 'I_UNDERSTAND_40_PROVIDER_RUNS'

function parseArguments(argv) {
  const result = {
    action: null,
    corpus: DEFAULT_CORPUS,
    config: DEFAULT_CONFIG,
    provider: null,
    lane: null,
    task: null,
    all: false,
    output: null,
    cache: join(tmpdir(), 'backend-team-harness-public-cache-v2'),
    model: null,
    mode: 'balanced',
    timeoutMs: 30 * 60 * 1000,
    maxBudgetUsd: 2,
    allowNetwork: false,
    resume: false,
    keepWorkspace: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--plan' || value === '--preflight' || value === '--execute') {
      if (result.action) throw new Error('Choose exactly one of --plan, --preflight, or --execute.')
      result.action = value.slice(2)
    } else if (value === '--all') result.all = true
    else if (value === '--allow-network') result.allowNetwork = true
    else if (value === '--resume') result.resume = true
    else if (value === '--keep-workspace') result.keepWorkspace = true
    else if (['--corpus', '--config', '--provider', '--lane', '--task', '--output', '--cache', '--model', '--mode', '--timeout-ms', '--max-budget-usd'].includes(value)) {
      const next = argv[++index]
      if (!next || next.startsWith('--')) throw new Error(value + ' requires a value.')
      const key = value.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
      result[key] = ['--timeout-ms', '--max-budget-usd'].includes(value) ? Number(next) : next
    } else throw new Error('Unknown argument: ' + value)
  }
  if (!result.action) throw new Error('Choose --plan, --preflight, or --execute.')
  if (result.provider !== null && !['codex', 'claude'].includes(result.provider)) throw new Error('--provider must be codex or claude.')
  if (result.lane !== null && !['bth', 'direct', 'both'].includes(result.lane)) throw new Error('--lane must be bth, direct, or both.')
  if (!['fast', 'balanced', 'deep'].includes(result.mode)) throw new Error('--mode must be fast, balanced, or deep.')
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 3_600_000) throw new Error('--timeout-ms is invalid.')
  if (typeof result.maxBudgetUsd !== 'number' || !Number.isFinite(result.maxBudgetUsd) || result.maxBudgetUsd < 0.01 || result.maxBudgetUsd > 100) throw new Error('--max-budget-usd is invalid.')
  if (result.all && result.task) throw new Error('--all and --task are mutually exclusive.')
  return result
}

async function git(args, cwd = undefined) {
  try {
    const result = await execute('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: buildSafeEnvironment() })
    return result.stdout.trim()
  } catch (error) {
    const diagnostic = typeof error?.stderr === 'string' ? error.stderr.slice(-4096).trim() : ''
    throw new Error('Benchmark Git command failed' + (diagnostic ? ': ' + diagnostic : '.'))
  }
}

async function exists(path) {
  try { return await lstat(path) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

async function safeDirectory(path, label) {
  await mkdir(path, { recursive: true })
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(label + ' is not a safe directory: ' + path)
  return path
}

async function ensureMirror(repository, cacheRoot) {
  await safeDirectory(cacheRoot, 'Benchmark cache')
  const mirror = resolve(cacheRoot, repository.id + '.git')
  const metadata = await exists(mirror)
  if (!metadata) {
    // This cache is intentionally complete. A local clone of a blobless mirror
    // cannot reliably lazy-fetch through the mirror's promisor remote, while a
    // complete mirror is shared by every sanitized task workspace.
    await git(['clone', '--mirror', '--quiet', repository.url, mirror])
  } else {
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Benchmark mirror is not a safe directory: ' + mirror)
    const bare = await git(['rev-parse', '--is-bare-repository'], mirror)
    const remote = await git(['remote', 'get-url', 'origin'], mirror)
    if (bare !== 'true' || remote !== repository.url) throw new Error('Benchmark mirror identity does not match ' + repository.id + '.')
    const mirrorConfig = await readFile(join(mirror, 'config'), 'utf8')
    if (/\bpromisor\s*=\s*true\b|\bpartialclonefilter\s*=/i.test(mirrorConfig)) {
      throw new Error('Benchmark mirror is a partial clone; choose a new --cache path so a complete shared mirror can be created.')
    }
  }
  for (const task of repository.tasks) {
    await git(['cat-file', '-e', task.baseSha + '^{commit}'], mirror)
    await git(['cat-file', '-e', task.targetSha + '^{commit}'], mirror)
  }
  return mirror
}

async function materializeSanitizedWorkspace(mirror, task, caseRoot) {
  const staging = join(caseRoot, 'staging')
  const project = join(caseRoot, 'project')
  await git(['clone', '--no-checkout', '--quiet', mirror, staging])
  await git(['checkout', '--detach', '--force', '--quiet', task.baseSha], staging)
  const symlinks = await git(['ls-tree', '-r', task.baseSha], staging)
  if (symlinks.split(/\r?\n/).some((line) => line.startsWith('120000 '))) {
    throw new Error(task.id + ': benchmark base tree contains a symlink and is not materialized automatically.')
  }
  await cp(staging, project, {
    recursive: true,
    filter(source) {
      const path = relative(staging, source).replaceAll('\\', '/')
      return path !== '.git' && !path.startsWith('.git/')
    }
  })
  await git(['init', '-q'], project)
  await git(['config', 'user.name', 'Backend Team Harness Benchmark'], project)
  await git(['config', 'user.email', 'bth-benchmark@example.invalid'], project)
  await git(['add', '-f', '--', '.'], project)
  await git([
    '-c', 'user.name=Backend Team Harness Benchmark',
    '-c', 'user.email=bth-benchmark@example.invalid',
    'commit', '-q', '-m', 'sanitized benchmark base'
  ], project)
  const commits = await git(['rev-list', '--count', 'HEAD'], project)
  if (commits !== '1') throw new Error('Sanitized benchmark workspace unexpectedly retained Git history.')
  return project
}

function compactProcess(result) {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdioDrainTimedOut: result.stdioDrainTimedOut,
    durationMs: result.durationMs,
    stdout: { sha256: result.stdout.sha256, bytes: result.stdout.bytes },
    stderr: { sha256: result.stderr.sha256, bytes: result.stderr.bytes }
  }
}

async function prepareDependencies(project, repositoryConfig, timeoutMs) {
  const [program, ...args] = repositoryConfig.setupCommand
  const result = await runProcess({
    program,
    args,
    cwd: project,
    timeoutMs,
    tailBytes: 16 * 1024,
    env: buildSafeEnvironment()
  })
  const passed = result.exitCode === 0 && !result.signal && !result.timedOut && !result.stdioDrainTimedOut
  if (!passed) return { passed: false, process: compactProcess(result) }
  const status = await git(['status', '--porcelain=v1', '--untracked-files=all'], project)
  if (status) throw new Error('Dependency preparation changed tracked or visible source paths; refusing an unfair provider run.')
  return { passed: true, process: compactProcess(result) }
}

async function preflightBaseVerification(project, repositoryConfig) {
  const harnessPath = resolve(project, '.backend-harness')
  if (await exists(harnessPath)) throw new Error('Benchmark source already owns .backend-harness; preflight cleanup would be ambiguous.')
  try {
    await initProject(project, { preferredSystem: repositoryConfig.buildSystem })
    const checked = await checkProject(project, { allowNetwork: true })
    const failedGate = checked.result?.gates?.find((gate) => gate.outcome === 'failed')
    const diagnosticText = ((failedGate?.process?.stdout?.tail ?? '') + '\n' + (failedGate?.process?.stderr?.tail ?? '')).toLowerCase()
    const diagnosticCode = /offline mode|cannot access .* in offline|not been downloaded/.test(diagnosticText)
      ? 'offline-dependency-cache-incomplete'
      : /compilation (?:error|failure)|failed to compile|compilejava failed/.test(diagnosticText)
        ? 'compilation-failed'
        : /there (?:are|were) test failures|tests? failed/.test(diagnosticText)
          ? 'tests-failed'
          : failedGate ? 'gate-process-failed' : null
    return {
      confirmed: checked.confirmed === true,
      failureCode: checked.confirmed ? null : checked.result?.failure?.code ?? 'verification-failed',
      diagnosticCode: checked.confirmed ? null : diagnosticCode,
      tests: checked.result?.tests ? {
        tests: checked.result.tests.tests,
        executed: checked.result.tests.executed,
        failures: checked.result.tests.failures,
        errors: checked.result.tests.errors,
        skipped: checked.result.tests.skipped
      } : null,
      gates: (checked.result?.gates ?? []).map((gate) => ({
        id: gate.id,
        outcome: gate.outcome,
        process: gate.process ? compactProcess(gate.process) : null
      }))
    }
  } catch (error) {
    return { confirmed: false, failureCode: error?.code ?? 'preflight-exception', tests: null, gates: [] }
  } finally {
    await rm(harnessPath, { recursive: true, force: true })
  }
}

function resultPath(output, caseEntry) {
  return resolve(output, caseEntry.provider, caseEntry.lane, caseEntry.taskId + '.json')
}

async function writeOnce(path, value) {
  await safeDirectory(dirname(path), 'Benchmark result parent')
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
}

function preProviderFailureCase(caseEntry, task, setup, preflight, elapsedMs) {
  const reason = setup.passed ? 'baseline-verification-failed' : 'dependency-setup-failed'
  return {
    schemaVersion: 1,
    case: caseEntry,
    fairness: { sanitizedSingleCommitHistory: true, goldHiddenFromProvider: true, fixedMode: null },
    setup,
    preflight,
    observation: null,
    score: {
      schemaVersion: 3,
      id: caseEntry.id,
      provider: caseEntry.provider,
      lane: caseEntry.lane,
      taskId: task.id,
      successAt1: false,
      verificationSuccessAt1: false,
      acceptanceConfirmed: null,
      failureReasons: [reason],
      providerCompleted: false,
      verificationConfirmed: false,
      attempts: 0,
      retries: 0,
      elapsedMs,
      usage: { provider: caseEntry.provider, tokens: { input: null, uncachedInput: null, output: null, cachedInput: null, cacheCreationInput: null, reasoningOutput: null, total: null }, costUsd: null, durationMs: null, turns: null },
      changedPaths: [], goldPathsChanged: [], unexpectedChangedPaths: [], changedGoldRecall: 0,
      ruleViolations: [],
      impactLocalization: null,
      outcomeLocalization: { taskId: task.id, goldPathCount: task.goldPaths.length, rankedPathCount: 0, recallAt5: 0, recallAt20: 0, ndcgAt20: 0 }
    }
  }
}

async function executeCase(caseEntry, corpus, config, options, providerProbe) {
  const repository = corpus.repositories.find((entry) => entry.id === caseEntry.repositoryId)
  const repositoryConfig = config.repositories.find((entry) => entry.id === repository.id)
  const task = repository.tasks.find((entry) => entry.id === caseEntry.taskId)
  const outputPath = resultPath(options.output, caseEntry)
  if (await exists(outputPath)) {
    if (options.resume) return { skipped: true, outputPath }
    throw new Error('Benchmark result already exists: ' + outputPath)
  }
  const caseRoot = await mkdtemp(join(tmpdir(), 'bth-provider-case-'))
  const startedAt = Date.now()
  let project = null
  try {
    const mirror = await ensureMirror(repository, options.cache)
    project = await materializeSanitizedWorkspace(mirror, task, caseRoot)
    const setup = await prepareDependencies(project, repositoryConfig, options.timeoutMs)
    if (!setup.passed) {
      const record = preProviderFailureCase(caseEntry, task, setup, null, Date.now() - startedAt)
      await writeOnce(outputPath, record)
      return { skipped: false, outputPath, record }
    }
    const preflight = await preflightBaseVerification(project, repositoryConfig)
    const cleanAfterPreflight = await git(['status', '--porcelain=v1', '--untracked-files=all'], project)
    if (cleanAfterPreflight) throw new Error('Baseline verification left visible source changes; refusing an unfair provider run.')
    if (!preflight.confirmed) {
      const record = preProviderFailureCase(caseEntry, task, setup, preflight, Date.now() - startedAt)
      await writeOnce(outputPath, record)
      return { skipped: false, outputPath, record }
    }
    const run = await runPreparedComparisonCase(project, task, repositoryConfig, {
      lane: caseEntry.lane,
      provider: caseEntry.provider,
      mode: options.mode,
      model: options.model,
      maxAttempts: 1,
      timeoutMs: options.timeoutMs,
      maxBudgetUsd: options.maxBudgetUsd
    }, {
      providerProbe: async () => providerProbe,
      providerVersion: providerProbe.version,
      cleanupBthWorkspace: !options.keepWorkspace
    })
    const record = {
      schemaVersion: 1,
      case: caseEntry,
      fairness: {
        sanitizedSingleCommitHistory: true,
        goldHiddenFromProvider: true,
        sameProvider: true,
        fixedMode: options.mode,
        setupCommandSha256: createDigest(repositoryConfig.setupCommand)
      },
      setup,
      preflight,
      observation: run.observation,
      score: run.score,
      totalElapsedMs: Date.now() - startedAt,
      workspace: options.keepWorkspace ? project : null
    }
    await writeOnce(outputPath, record)
    return { skipped: false, outputPath, record }
  } finally {
    if (!options.keepWorkspace) await rm(caseRoot, { recursive: true, force: true })
  }
}

async function executePreflight(caseEntry, corpus, config, options) {
  const repository = corpus.repositories.find((entry) => entry.id === caseEntry.repositoryId)
  const repositoryConfig = config.repositories.find((entry) => entry.id === repository.id)
  const task = repository.tasks.find((entry) => entry.id === caseEntry.taskId)
  const outputPath = resolve(options.output, 'preflight', task.id + '.json')
  if (await exists(outputPath)) {
    if (options.resume) return { skipped: true, outputPath }
    throw new Error('Benchmark preflight result already exists: ' + outputPath)
  }
  const caseRoot = await mkdtemp(join(tmpdir(), 'bth-provider-preflight-'))
  const startedAt = Date.now()
  try {
    const mirror = await ensureMirror(repository, options.cache)
    const project = await materializeSanitizedWorkspace(mirror, task, caseRoot)
    const setup = await prepareDependencies(project, repositoryConfig, options.timeoutMs)
    const preflight = setup.passed ? await preflightBaseVerification(project, repositoryConfig) : null
    const record = {
      schemaVersion: 1,
      repositoryId: repository.id,
      taskId: task.id,
      baseSha: task.baseSha,
      sanitizedSingleCommitHistory: true,
      setup,
      preflight,
      readyForProviderComparison: setup.passed && preflight?.confirmed === true,
      elapsedMs: Date.now() - startedAt,
      workspace: options.keepWorkspace ? project : null
    }
    await writeOnce(outputPath, record)
    return { skipped: false, outputPath, record }
  } finally {
    if (!options.keepWorkspace) await rm(caseRoot, { recursive: true, force: true })
  }
}

function createDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function reportFromOutput(output) {
  const scores = []
  for (const provider of ['codex', 'claude']) {
    for (const lane of ['bth', 'direct']) {
      const directory = resolve(output, provider, lane)
      const metadata = await exists(directory)
      if (!metadata?.isDirectory()) continue
      for (const name of (await readdir(directory)).filter((entry) => entry.endsWith('.json')).sort()) {
        const record = JSON.parse(await readFile(join(directory, name), 'utf8'))
        if (record.score) scores.push(record.score)
      }
    }
  }
  return compareProviderLanes(scores)
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const corpus = await loadEvaluationCorpus(resolve(options.corpus))
  const config = await loadProviderBenchmarkConfig(resolve(options.config), corpus)
  const providers = options.provider ? [options.provider] : ['codex', 'claude']
  const lanes = options.lane === 'both' || options.lane === null ? ['bth', 'direct'] : [options.lane]
  const taskIds = options.task ? [options.task] : null
  const matrix = buildComparisonMatrix(corpus, { providers, lanes, taskIds })
  if (options.action === 'plan') {
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      corpus: { id: corpus.id, repositories: corpus.repositoryCount, tasks: corpus.taskCount },
      selectedCases: matrix.length,
      providerCalls: matrix.length,
      cases: matrix,
      executionSafety: {
        oneCaseRequires: 'BTH_PROVIDER_BENCHMARK=' + EXECUTE_ACK + ' and --allow-network',
        allCasesRequire: 'BTH_PROVIDER_BENCHMARK_ALL=' + ALL_ACK,
        note: 'A both-lane all-task run for one provider makes 40 authenticated provider calls.'
      }
    }, null, 2) + '\n')
    return
  }
  if (options.action === 'preflight') {
    if ((!options.task && !options.all) || !options.output || !options.allowNetwork) {
      throw new Error('--preflight requires exactly one of --task|--all, --output, and --allow-network.')
    }
    const preflightMatrix = buildComparisonMatrix(corpus, {
      providers: ['codex'],
      lanes: ['bth'],
      taskIds: options.task ? [options.task] : null
    })
    await safeDirectory(resolve(options.output), 'Benchmark output')
    for (const caseEntry of preflightMatrix) {
      const result = await executePreflight(caseEntry, corpus, config, {
        ...options,
        output: resolve(options.output),
        cache: resolve(options.cache)
      })
      process.stderr.write((result.skipped ? '[SKIP] ' : '[PREFLIGHT] ') + caseEntry.taskId + ' -> ' + result.outputPath + '\n')
    }
    return
  }
  if (!options.provider || !options.lane || (!options.task && !options.all) || !options.output) {
    throw new Error('--execute requires --provider, --lane, exactly one of --task|--all, and --output.')
  }
  if (!options.allowNetwork || process.env.BTH_PROVIDER_BENCHMARK !== EXECUTE_ACK) {
    throw new Error('Execution requires --allow-network and BTH_PROVIDER_BENCHMARK=' + EXECUTE_ACK + '.')
  }
  if (options.all && process.env.BTH_PROVIDER_BENCHMARK_ALL !== ALL_ACK) {
    throw new Error('An all-task run requires BTH_PROVIDER_BENCHMARK_ALL=' + ALL_ACK + '.')
  }
  const probe = await probeImplementationProvider(options.provider)
  if (!probe.available) throw new Error('Selected provider is unavailable: ' + options.provider)
  await safeDirectory(resolve(options.output), 'Benchmark output')
  for (const caseEntry of matrix) {
    const result = await executeCase(caseEntry, corpus, config, {
      ...options,
      output: resolve(options.output),
      cache: resolve(options.cache)
    }, probe)
    process.stderr.write((result.skipped ? '[SKIP] ' : '[RECORDED] ') + caseEntry.id + ' -> ' + result.outputPath + '\n')
  }
  const comparison = await reportFromOutput(resolve(options.output))
  const summaryPath = resolve(options.output, 'summary-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json')
  await writeOnce(summaryPath, { schemaVersion: 1, corpusId: corpus.id, comparisons: comparison })
  process.stdout.write(JSON.stringify({ summaryPath, comparisons: comparison }, null, 2) + '\n')
}

await main()
