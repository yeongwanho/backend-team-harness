import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { configureImplementationProvider } from '../config/implementation-setup.mjs'
import { buildSafeEnvironment } from '../core/process-runner.mjs'
import { resolveSafeProjectPath } from '../fs-safety.mjs'
import { initProject } from '../init-project.mjs'
import { approvedValidationCommands, runImplementationProvider, runProviderPrompt, selectImplementationProfile, TEST_AUTHORING_CONTRACT } from '../providers/model-cli.mjs'
import { checkProject } from '../runtime/backend-harness.mjs'
import { implementationStatus, resetImplementation } from '../runtime/implementation-orchestrator.mjs'
import { runWork } from '../runtime/work-orchestrator.mjs'
import { scoreProviderCase } from './provider-comparison.mjs'
import { compactImplementationVerification, implementationFailureSummary } from '../core/implementation-verification.mjs'
import { inspectProjectFixture } from './project-fixture.mjs'
import { verificationInputPaths } from '../config/verification.mjs'
import { snapshotImplementedFiles } from '../core/implementation-record-store.mjs'
import { createWorkflowBudget } from './workflow-budget.mjs'

const execute = promisify(execFile)
const MAX_GIT_OUTPUT = 16 * 1024 * 1024
const RULE_OUTCOMES = new Set([
  'control-plane-change', 'source-binding-failed', 'workspace-history-change', 'shared-refs-change',
  'index-flags-change', 'write-policy-violation', 'gate-integrity-failure', 'formatting-integrity-failure', 'original-source-change'
])

async function git(root, args, options = {}) {
  try {
    const result = await execute('git', args, {
      cwd: root,
      encoding: options.encoding ?? 'utf8',
      maxBuffer: MAX_GIT_OUTPUT,
      env: buildSafeEnvironment()
    })
    return result.stdout
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.slice(-4096) : ''
    throw new Error('Benchmark Git operation failed' + (stderr ? ': ' + stderr.trim() : '.'))
  }
}

function processPassed(process) {
  return process?.exitCode === 0 && !process.signal && process.timedOut !== true && process.stdioDrainTimedOut !== true
}

function prefixAllows(path, prefixes) {
  return prefixes.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)
}

async function changedPaths(root, baseCommit) {
  const [tracked, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', '--no-renames', '-z', baseCommit, '--']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  ])
  return [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()
}

async function fixtureInputSnapshot(root, fixture) {
  if (!fixture) return null
  const files = await snapshotImplementedFiles(root, verificationInputPaths(fixture.verification).map(path => path.replace(/^\.\//, '')))
  if (files.some(file => file.kind !== 'file')) throw new Error('Prepared verification input is missing before provider execution.')
  return files
}

async function fixtureInputsChanged(root, fixture, before) {
  if (!before) return false
  try { return JSON.stringify(await fixtureInputSnapshot(root, fixture)) !== JSON.stringify(before) }
  catch { return true }
}

async function directRuleViolations(root, baseCommit, paths, repositoryConfig, projectFixture, protectedInputs) {
  const violations = []
  const currentHead = (await git(root, ['rev-parse', 'HEAD'])).trim()
  if (currentHead !== baseCommit) violations.push('provider-changed-git-history')
  const outside = paths.filter((path) => !prefixAllows(path, repositoryConfig.allowedPrefixes))
  if (outside.length) violations.push('outside-approved-prefixes:' + outside.slice(0, 32).join(','))
  if (!(await inspectProjectFixture(root, projectFixture)).valid) violations.push('protected-project-fixture-change')
  if (await fixtureInputsChanged(root, projectFixture, protectedInputs)) violations.push('protected-verification-input-change')
  if (paths.length > 100) violations.push('changed-file-budget-exceeded')
  const binaryDiff = await git(root, ['diff', '--binary', '--full-index', '--no-renames', baseCommit, '--'])
  if (Buffer.byteLength(binaryDiff) > 2 * 1024 * 1024) violations.push('diff-byte-budget-exceeded')
  try {
    await git(root, ['diff', '--check', baseCommit, '--'])
  } catch {
    violations.push('git-diff-check-failed')
  }
  return violations
}

function directPrompt(task, repositoryConfig, validationCommands = []) {
  const decision = repositoryConfig.tasks.find((entry) => entry.id === task.id)?.decisions
  if (!decision) throw new Error('Benchmark decisions are missing for ' + task.id + '.')
  return [
    'Implement exactly one backend task in the current repository: ' + task.requirement,
    'Approved decisions: ' + JSON.stringify(decision) + '.',
    'Read only repository-owned instruction or architecture sections directly relevant to this task, then inspect the most relevant adjacent production example and its matching test when present; do not reread every policy document.',
    'Write only inside these approved paths: ' + repositoryConfig.allowedPrefixes.join(', ') + '.',
    ...(repositoryConfig.tasks.find(entry => entry.id === task.id)?.projectFixture ? [
      'The evaluator-owned baseline fixtures and verification configuration are immutable even inside approved paths: ' + repositoryConfig.tasks.find(entry => entry.id === task.id).projectFixture.files.map(file => file.path).join(', ') + '.'
    ] : []),
    'Preserve observed naming, layering, DTO/error, persistence, transaction, migration, and test patterns. Do not guess through an unknown or conflicting project rule.',
    'Do not read .env files, credentials, private keys, tokens, or unrelated user data. Do not commit, change Git refs, deploy, access production, or use a production database.',
    validationCommands.length ? TEST_AUTHORING_CONTRACT.replace('executing them belongs to the evaluator.', 'execute the approved verification commands and repair concrete failures within this session.') : TEST_AUTHORING_CONTRACT,
    validationCommands.length
      ? 'Run these exact prepared commands from the repository root after editing: ' + approvedValidationCommands(validationCommands).map(command => JSON.stringify(command)).join(', ') + '. These are the only approved validation commands; their reviewed wrappers own local fixtures. Do not install dependencies, run other Docker/database commands, change verification inputs, or claim success from your final text. If a gate fails, inspect the failure, fix within the approved scope, and rerun it within this session. Independent acceptance is hidden and evaluated afterwards.'
      : 'Do not run build, test, formatter, linter, package-manager, Docker, or database commands; the benchmark evaluator owns the same project-declared structured verification used for the harness lane.',
    'Finish after making the smallest complete implementation and focused tests. Do not manually create or edit benchmark or harness metadata files; only declared verification commands may write their generated reports.'
  ].join(' ')
}

function sumNullable(values) {
  return values.length > 0 && values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

function combinedUsage(attempts, provider) {
  const usages = attempts.map((attempt) => attempt?.invocation?.usage).filter(Boolean)
  const token = (key) => sumNullable(usages.map((entry) => entry.tokens?.[key] ?? null))
  return {
    provider,
    tokens: {
      input: token('input'),
      uncachedInput: token('uncachedInput'),
      output: token('output'),
      cachedInput: token('cachedInput'),
      cacheCreationInput: token('cacheCreationInput'),
      reasoningOutput: token('reasoningOutput'),
      total: token('total')
    },
    costUsd: sumNullable(usages.map((entry) => entry.costUsd ?? null)),
    durationMs: sumNullable(usages.map((entry) => entry.durationMs ?? null)),
    turns: sumNullable(usages.map((entry) => entry.turns ?? null))
  }
}

async function requestMetrics(workspace, attempt) {
  const requestPath = attempt?.request?.path
  if (typeof requestPath !== 'string') return null
  const absolute = await resolveSafeProjectPath(workspace, requestPath.replace(/^\.\//, ''))
  const text = await readFile(absolute, 'utf8')
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Benchmark implementation request exceeded 1 MiB.')
  const request = JSON.parse(text)
  const paths = (request.codeContext?.entries ?? []).map((entry) => entry.path).filter((path) => typeof path === 'string')
  return {
    bytes: Buffer.byteLength(text),
    codeContextPaths: paths,
    codeContextCharacters: request.codeContext?.budget?.usedCharacters ?? null,
    projectRuleCount: request.projectConventions?.projectRules?.rules?.length ?? 0,
    knowledgeDocumentCount: request.projectConventions?.knowledgeDocuments?.paths?.length ?? 0
  }
}

async function commitHarnessContract(root) {
  // A user-level global ignore may suppress every .gitignore file. The isolated
  // worktree must still receive this project-owned boundary so local request and
  // evidence files cannot be mistaken for candidate source changes.
  await git(root, ['add', '-f', '--', '.backend-harness/.gitignore'])
  await git(root, ['add', '--', '.backend-harness'])
  if (!(await git(root, ['diff', '--cached', '--name-only'])).trim()) return (await git(root, ['rev-parse', 'HEAD'])).trim()
  await git(root, [
    '-c', 'user.name=Backend Team Harness Benchmark',
    '-c', 'user.email=bth-benchmark@example.invalid',
    'commit', '-q', '-m', 'benchmark harness contract'
  ])
  return (await git(root, ['rev-parse', 'HEAD'])).trim()
}

async function taskAcceptance(candidateRoot, eligible, options) {
  if (!eligible) return { controlsConfirmed: false, candidatePassed: null, reason: 'candidate-not-eligible' }
  if (typeof options.acceptanceEvaluator !== 'function') return { controlsConfirmed: false, candidatePassed: null, reason: 'task-oracle-not-defined' }
  try {
    return await options.acceptanceEvaluator({ candidateRoot })
  } catch {
    // Preserve the paid implementation evidence even if evaluator preparation
    // fails. A missing oracle result must not become a candidate success.
    return { controlsConfirmed: false, candidatePassed: null, reason: 'oracle-evaluation-failed' }
  }
}

async function runBthLane(root, task, repositoryConfig, input, options) {
  const budget = input.workflow === 'native-workflow' ? createWorkflowBudget(input) : null
  const providerRunner = options.bthProviderRunner ?? runImplementationProvider
  await initProject(root, { preferredSystem: repositoryConfig.buildSystem })
  await configureImplementationProvider(root, input.provider, {
    force: true,
    mode: input.mode,
    model: input.model,
    allowedPrefixes: repositoryConfig.allowedPrefixes,
    maxChangedFiles: 100,
    maxDiffBytes: 2 * 1024 * 1024,
    maxAttempts: input.maxAttempts,
    timeoutMs: input.timeoutMs,
    maxBudgetUsd: input.provider === 'claude' ? input.maxBudgetUsd : null
  })
  await commitHarnessContract(root)
  const taskId = 'BENCH-' + createHash('sha256').update(task.id).digest('hex').slice(0, 16).toUpperCase()
  const startedAt = Date.now()
  let primaryError = null
  try {
    const result = await runWork(root, {
      taskId,
      actor: 'provider-benchmark',
      requirement: task.requirement,
      decisions: repositoryConfig.tasks.find((entry) => entry.id === task.id).decisions
    }, {
      approve: true,
      run: true,
      allowWrite: true,
      allowNetwork: true,
      providerProbe: options.providerProbe,
      providerRunner: budget ? (adapter, input, options) => budget.run(providerRunner, adapter, input, options) : options.bthProviderRunner
    })
    const elapsedMs = Date.now() - startedAt
    const record = result.implementation?.record
    const attempts = record?.attempts ?? []
    const workspace = record?.workspace
    const paths = record?.changedFiles?.paths ?? []
    const request = workspace && attempts.length ? await requestMetrics(workspace, attempts[0]).catch(() => null) : null
    const ruleViolations = attempts
      .filter((attempt) => RULE_OUTCOMES.has(attempt.outcome))
      .map((attempt) => 'bth-' + attempt.outcome)
    if (attempts.some((attempt) => (attempt.invocation?.activity?.validationCommandCount ?? 0) > 0)) {
      ruleViolations.push('provider-ran-evaluator-owned-validation')
    }
    const acceptance = await taskAcceptance(workspace, Boolean(workspace) && record?.verification?.confirmed === true && ruleViolations.length === 0, options)
    return {
      provider: input.provider,
      lane: 'bth',
      providerCompleted: attempts.length > 0 && (budget ? processPassed(attempts.at(-1).adapter) : attempts.every((attempt) => processPassed(attempt.adapter))),
      verificationConfirmed: record?.verification?.confirmed === true,
      acceptance,
      attempts: budget ? budget.snapshot().invocations : attempts.length,
      repairAttempts: budget ? Math.max(0, budget.snapshot().invocations - 1) : null,
      elapsedMs,
      changedPaths: paths,
      impactPaths: request?.codeContextPaths?.length ? request.codeContextPaths : null,
      ruleViolations,
      usage: combinedUsage(attempts, input.provider),
      evidence: {
        providerBudget: budget?.snapshot() ?? null,
        providerVersions: [...new Set(attempts.map(attempt => attempt.invocation?.version).filter(Boolean))],
        taskState: result.task?.state ?? null,
        implementationStatus: record?.status ?? null,
        workflowStatus: result.status,
        preservationReview: result.implementation?.preservationReview ?? null,
        verificationRunPath: record?.verification?.runPath ?? null,
        failureCode: record?.preparation?.failureCode ?? record?.verification?.failure?.code ?? (record?.verification?.confirmed === false ? 'verification-not-confirmed' : null),
        preparation: record?.preparation ?? null,
        verificationTests: record?.verification?.tests ?? null,
        verificationGates: (record?.verification?.gates ?? []).map(gate => ({ id: gate.id, outcome: gate.outcome })),
        implementationDiagnosis: record ? implementationFailureSummary(record) : null,
        request: request ? {
          bytes: request.bytes,
          codeContextEntries: request.codeContextPaths.length,
          codeContextCharacters: request.codeContextCharacters,
          projectRuleCount: request.projectRuleCount,
          knowledgeDocumentCount: request.knowledgeDocumentCount
        } : null,
        providerActivity: attempts.map((attempt) => attempt.invocation?.activity).filter(Boolean),
        workspaceRetainedForAudit: Boolean(workspace) && options.cleanupBthWorkspace !== true
      }
    }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (options.cleanupBthWorkspace === true) {
      try {
        const status = await implementationStatus(root, taskId)
        if (status.record?.workspace) {
          await resetImplementation(root, taskId, { actor: 'provider-benchmark', discardWorkspace: true })
        }
      } catch (cleanupError) {
        if (!primaryError && !/No implementation run exists/.test(String(cleanupError?.message))) throw cleanupError
      }
    }
  }
}

async function runDirectLane(root, task, repositoryConfig, input, options) {
  const baseCommit = (await git(root, ['rev-parse', 'HEAD'])).trim()
  const projectFixture = repositoryConfig.tasks.find(entry => entry.id === task.id)?.projectFixture
  const protectedInputs = await fixtureInputSnapshot(root, projectFixture)
  const profile = selectImplementationProfile({ mode: input.mode, taskCharacters: task.requirement.length })
  const adapter = {
    provider: input.provider,
    model: input.model,
    timeoutMs: input.timeoutMs,
    maxBudgetUsd: input.provider === 'claude' ? input.maxBudgetUsd : null,
    ...(input.workflow === 'native-workflow' ? { validationCommands: projectFixture.verification.gates.filter(gate => gate.required).map(gate => gate.command) } : {})
  }
  const budget = input.workflow === 'native-workflow' ? createWorkflowBudget(input) : null
  const startedAt = Date.now()
  const directRunner = options.directProviderRunner ?? runProviderPrompt
  const prompt = directPrompt(task, repositoryConfig, adapter.validationCommands)
  const executeProvider = budget ? (...args) => budget.run(directRunner, ...args) : directRunner
  const run = await executeProvider(adapter, {
    cwd: root,
    prompt,
    profile,
    env: buildSafeEnvironment()
  }, { version: options.providerVersion })
  const paths = await changedPaths(root, baseCommit)
  const ruleViolations = await directRuleViolations(root, baseCommit, paths, repositoryConfig,
    projectFixture, protectedInputs)
  if (!budget && (run.metadata?.activity?.validationCommandCount ?? 0) > 0) {
    ruleViolations.push('provider-ran-evaluator-owned-validation')
  }
  let verificationConfirmed = false
  let verificationFailure = null
  let verificationTests = null
  let verificationDiagnostic = null
  if (processPassed(run.process) && paths.length > 0 && ruleViolations.length === 0) {
    try {
      await initProject(root, { preferredSystem: repositoryConfig.buildSystem })
      const checked = await (options.projectChecker ?? checkProject)(root, { allowNetwork: true })
      verificationConfirmed = checked.confirmed === true
      verificationDiagnostic = compactImplementationVerification(checked)
      verificationTests = checked.result?.tests ?? null
      verificationFailure = checked.confirmed ? null : verificationDiagnostic.failure?.code ?? 'verification-failed'
    } catch (error) {
      verificationFailure = error?.code ?? 'verification-exception'
    }
  }
  if (await fixtureInputsChanged(root, projectFixture, protectedInputs)) {
    verificationConfirmed = false
    verificationFailure = 'protected-verification-input-change'
    if (!ruleViolations.includes(verificationFailure)) ruleViolations.push(verificationFailure)
  }
  const elapsedMs = Date.now() - startedAt
  const acceptance = await taskAcceptance(root, verificationConfirmed && ruleViolations.length === 0, options)
  return {
    provider: input.provider,
    lane: 'direct',
    providerCompleted: processPassed(run.process),
    nativeValidationConfirmed: budget ? run.metadata?.activity?.approvedValidation?.complete === true ? true : null : null,
    verificationConfirmed,
    acceptance,
    attempts: 1,
    elapsedMs,
    changedPaths: paths,
    impactPaths: run.metadata?.activity?.preWritePaths?.length ? run.metadata.activity.preWritePaths : null,
    ruleViolations,
    usage: run.metadata?.usage ?? {},
    evidence: {
      providerBudget: budget?.snapshot() ?? null,
      providerVersion: run.metadata?.version ?? null,
      providerProfile: run.metadata?.profile ?? profile,
      nativeValidation: budget ? run.metadata?.activity?.approvedValidation ?? { complete: false, status: 'unobserved' } : null,
      providerFailureCode: run.metadata?.failure?.code ?? null,
      verificationFailureCode: verificationFailure,
      verificationTests,
      verificationDiagnostic,
      request: { promptBytes: Buffer.byteLength(prompt) },
      providerActivity: run.metadata?.activity ?? null,
      process: {
        exitCode: run.process?.exitCode ?? null,
        signal: run.process?.signal ?? null,
        timedOut: run.process?.timedOut === true,
        stdout: run.process?.stdout ? { sha256: run.process.stdout.sha256, bytes: run.process.stdout.bytes } : null,
        stderr: run.process?.stderr ? { sha256: run.process.stderr.sha256, bytes: run.process.stderr.bytes } : null
      }
    }
  }
}

export async function runPreparedComparisonCase(root, task, repositoryConfig, input, options = {}) {
  const startedAt = Date.now()
  const workflow = input.workflow ?? 'controlled-edit'
  if (!['controlled-edit', 'native-workflow'].includes(workflow)) throw new Error('Unknown comparison workflow.')
  const maxAttempts = input.maxAttempts ?? (workflow === 'native-workflow' ? 3 : 1)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 || (workflow === 'controlled-edit' && maxAttempts !== 1)) throw new Error('Invalid comparison recovery limit.')
  input = { ...input, workflow, maxAttempts }
  if (!['bth', 'direct'].includes(input.lane)) throw new Error('Benchmark lane must be bth or direct.')
  if (!['codex', 'claude'].includes(input.provider)) throw new Error('Benchmark provider must be codex or claude.')
  const status = await git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status.trim()) throw new Error('Benchmark case requires a clean prepared Git workspace.')
  if (!(await inspectProjectFixture(root, repositoryConfig.tasks.find(entry => entry.id === task.id)?.projectFixture)).valid) throw new Error('Benchmark project fixture is missing or changed before provider execution.')
  if (workflow === 'native-workflow') {
    const fixture = repositoryConfig.tasks.find(entry => entry.id === task.id)?.projectFixture
    const commands = fixture?.verification?.gates?.filter(gate => gate.required).map(gate => gate.command)
    if (!commands?.length) throw new Error('Native workflow requires pinned prepared verification commands.')
    approvedValidationCommands(commands)
  }
  const observation = input.lane === 'bth'
    ? await runBthLane(root, task, repositoryConfig, input, options)
    : await runDirectLane(root, task, repositoryConfig, input, options)
  observation.workflow = workflow
  if (workflow === 'native-workflow') {
    observation.evidence.executionAndVerificationMs = observation.elapsedMs
    observation.elapsedMs = Date.now() - startedAt
    observation.evidence.elapsedScope = 'prepared-workspace-to-final-independent-acceptance; includes setup of BTH contract, implementation, verification and acceptance, excludes common fixture/dependency preflight'
  }
  return {
    observation,
    score: scoreProviderCase(task, observation)
  }
}
