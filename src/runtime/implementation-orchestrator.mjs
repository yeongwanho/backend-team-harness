import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { loadImplementationConfig, resolveImplementationExecutable } from '../config/implementation.mjs'
import { loadVerificationConfig } from '../config/verification.mjs'
import { canonicalJson } from '../core/canonical-json.mjs'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { advanceTask, loadTask } from '../core/task-store.mjs'
import { assertTaskId } from '../core/task-state.mjs'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { captureConfiguredSourceBinding, checkProject } from './backend-harness.mjs'

const MAX_GIT_OUTPUT = 8 * 1024 * 1024

function runGit(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], { env: buildSafeEnvironment(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = [], stderr = []
    let bytes = 0, overflow = false
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > MAX_GIT_OUTPUT) { overflow = true; child.kill('SIGTERM') } else stdout.push(chunk) })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (overflow) return reject(new Error('Git implementation workspace output exceeded 8 MiB.'))
      if (code !== 0) return reject(new Error('Git implementation workspace command failed: ' + (Buffer.concat(stderr).toString('utf8').trim() || 'exit ' + code)))
      resolvePromise(Buffer.concat(stdout).toString('utf8'))
    })
  })
}

async function atomicJson(path, value) {
  const temporary = resolve(dirname(path), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function compactProcess(result) {
  return {
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
    stdioDrainTimedOut: result.stdioDrainTimedOut,
    startedAt: result.startedAt, finishedAt: result.finishedAt, durationMs: result.durationMs,
    stdout: { sha256: result.stdout.sha256, bytes: result.stdout.bytes },
    stderr: { sha256: result.stderr.sha256, bytes: result.stderr.bytes }
  }
}

function processPassed(result) {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false && result.stdioDrainTimedOut !== true
}

function compactVerification(result) {
  return {
    confirmed: result.confirmed,
    sourceFingerprint: result.sourceBinding?.fingerprint ?? null,
    runPath: result.run?.path ?? null,
    failure: result.failure ?? null,
    tests: result.result?.tests ?? null,
    gates: (result.result?.gates ?? []).map((gate) => ({
      id: gate.id, required: gate.required, outcome: gate.outcome, reason: gate.reason ?? null,
      failedTests: (gate.result?.failedTests ?? []).slice(0, 32)
    }))
  }
}

function recoveryInput(verification) {
  if (!verification) return null
  return {
    failure: verification.failure,
    failedGates: verification.gates.filter((gate) => gate.outcome !== 'passed').slice(0, 16)
  }
}

function adapterFailureVerification(result, sourceFingerprint) {
  const reason = result.timedOut
    ? 'timed out'
    : result.stdioDrainTimedOut
      ? 'left descendant stdio open'
      : result.signal
        ? 'was terminated by signal ' + result.signal
        : 'exited with code ' + result.exitCode
  return {
    confirmed: false,
    sourceFingerprint,
    runPath: null,
    failure: {
      code: 'implementation_adapter_failed',
      message: 'The project-owned implementation adapter ' + reason + '.'
    },
    tests: null,
    gates: []
  }
}

async function workspaceStatus(worktree) {
  const output = await runGit(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const entries = output.split('\0').filter(Boolean).slice(0, 4096)
  return {
    changedEntryCount: entries.length,
    truncated: output.split('\0').filter(Boolean).length > entries.length,
    paths: entries.map((entry) => entry.slice(3)).filter(Boolean),
    digest: createHash('sha256').update(output).digest('hex')
  }
}

async function changedPathsAgainstHead(worktree) {
  const [tracked, untracked] = await Promise.all([
    runGit(worktree, ['diff', '--name-only', '-z', 'HEAD', '--']),
    runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  ])
  return [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()
}

async function evaluateWritePolicy(worktree, paths, policy) {
  const outside = paths.filter((path) => !policy.allowedPrefixes.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix))
  const trackedDiff = await runGit(worktree, ['diff', '--binary', '--full-index', 'HEAD', '--'])
  const untracked = (await runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--'])).split('\0').filter(Boolean)
  let untrackedBytes = 0
  const unsafeEntries = []
  for (const path of untracked) {
    const metadata = await lstat(resolve(worktree, path))
    if (!metadata.isFile() || metadata.isSymbolicLink()) unsafeEntries.push(path)
    else untrackedBytes += metadata.size
  }
  const diffBytes = Buffer.byteLength(trackedDiff) + untrackedBytes
  const reasons = []
  if (outside.length > 0) reasons.push('outside allowed prefixes: ' + outside.join(', '))
  if (paths.length > policy.maxChangedFiles) reasons.push('changed files ' + paths.length + ' exceed ' + policy.maxChangedFiles)
  if (diffBytes > policy.maxDiffBytes) reasons.push('diff bytes ' + diffBytes + ' exceed ' + policy.maxDiffBytes)
  if (unsafeEntries.length > 0) reasons.push('non-regular untracked entries: ' + unsafeEntries.join(', '))
  return { passed: reasons.length === 0, changedFiles: paths.length, diffBytes, outside, unsafeEntries, reasons }
}

function protectedControlPlaneChanges(paths, implementationConfig, verificationConfig) {
  const protectedPaths = new Set([
    '.backend-harness/verification.json',
    '.backend-harness/implementation.json',
    '.backend-harness/project-rules.json',
    implementationConfig.adapter.command[0].replace(/^\.\//, ''),
    ...verificationConfig.gates.map((gate) => gate.command[0].replace(/^\.\//, ''))
  ])
  return paths.filter((path) => protectedPaths.has(path))
}

async function createWorkspace(root, taskId, sourceBinding) {
  const worktreesRoot = await resolveSafeProjectPath(root, '.backend-harness/local/worktrees')
  await mkdir(worktreesRoot, { recursive: true, mode: 0o700 })
  await assertNoSymlinkSegments(root, worktreesRoot)
  const name = taskId.toLowerCase().replace(/[^a-z0-9._-]/g, '-') + '-' + randomUUID().slice(0, 8)
  const worktree = resolve(worktreesRoot, name)
  await runGit(root, ['worktree', 'add', '--detach', worktree, sourceBinding.headCommit])
  const relativePath = relative(root, worktree).replaceAll('\\', '/')
  return { path: worktree, relativePath }
}

async function loadRecord(root, taskId) {
  const path = await resolveSafeProjectPath(root, '.backend-harness/local/implementation/' + taskId + '.json')
  const metadata = await statPath(path)
  if (!metadata) return { path, record: null }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4 * 1024 * 1024) throw new Error('Implementation record is unsafe or exceeds 4 MiB.')
  const record = JSON.parse(await readFile(path, 'utf8'))
  const { recordSha256, ...unsigned } = record
  if (recordSha256 !== createHash('sha256').update(canonicalJson(unsigned)).digest('hex') || record.taskId !== taskId) {
    throw new Error('Implementation record seal is invalid.')
  }
  return { path, record }
}

async function saveRecord(path, record) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const sealed = { ...record, recordSha256: createHash('sha256').update(canonicalJson(record)).digest('hex') }
  await atomicJson(path, sealed)
  return sealed
}

export async function implementationStatus(inputPath, taskId) {
  const root = await resolveReadableRoot(inputPath)
  const id = assertTaskId(taskId)
  const loaded = await loadRecord(root, id)
  if (!loaded.record) throw new Error('No implementation run exists for task ' + taskId + '.')
  return { root, path: relative(root, loaded.path).replaceAll('\\', '/'), record: loaded.record }
}

async function runUnlocked(root, taskId, options) {
  const loadedTask = await loadTask(root, taskId)
  if (!['PLAN_APPROVED', 'IMPLEMENTING'].includes(loadedTask.record.state)) {
    throw new Error('Implementation requires task state PLAN_APPROVED or IMPLEMENTING; current state is ' + loadedTask.record.state + '.')
  }
  if (!loadedTask.record.approvalReceipt || !loadedTask.record.plan) throw new Error('Implementation requires a source-bound human-approved plan.')
  const loadedConfig = await loadImplementationConfig(root)
  if (!loadedConfig.config.adapter) throw new Error('Implementation adapter is disabled. Configure .backend-harness/implementation.json first.')
  if (loadedConfig.config.adapter.network && options.allowNetwork !== true) throw new Error('Implementation adapter declares network access; pass --allow-network explicitly.')
  if (options.allowWrite !== true) throw new Error('Implementation changes require explicit --allow-write approval.')

  const sourceBinding = await captureConfiguredSourceBinding(root)
  const acceptedFingerprints = new Set([sourceBinding.fingerprint, sourceBinding.legacyFingerprint].filter(Boolean))
  if (!sourceBinding.clean) throw new Error('Implementation requires a clean source-bound worktree. Commit or stash source changes first.')
  if (!acceptedFingerprints.has(loadedTask.record.planSourceFingerprint) || !acceptedFingerprints.has(loadedTask.record.approvalReceipt.sourceFingerprint)) {
    throw new Error('Approved plan source is stale. Rebind and approve the plan against the current source.')
  }

  const prior = await loadRecord(root, taskId)
  if (prior.record?.status === 'passed') return { root, path: relative(root, prior.path).replaceAll('\\', '/'), record: prior.record }
  let workspace
  if (prior.record) {
    const path = await resolveSafeProjectPath(root, prior.record.workspace)
    const metadata = await statPath(path)
    if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new Error('Recorded implementation workspace is missing or unsafe.')
    if (prior.record.baseSourceFingerprint !== sourceBinding.fingerprint) throw new Error('Existing implementation workspace belongs to a different source fingerprint.')
    workspace = { path, relativePath: prior.record.workspace }
  } else {
    workspace = await createWorkspace(root, taskId, sourceBinding)
  }

  if (loadedTask.record.state === 'PLAN_APPROVED') {
    const transition = await advanceTask(root, taskId, 'IMPLEMENTING', { actor: options.actor, reason: 'Started isolated implementation workspace.' })
    if (!transition.applied) throw new Error('Could not advance task to IMPLEMENTING: ' + transition.audit.reason)
  }

  const adapter = await resolveImplementationExecutable(workspace.path, loadedConfig.config.adapter.command)
  const verificationConfig = (await loadVerificationConfig(workspace.path)).config
  const requestDir = await resolveSafeProjectPath(workspace.path, '.backend-harness/local/implementation')
  await mkdir(requestDir, { recursive: true, mode: 0o700 })
  const requestPath = resolve(requestDir, 'request-' + taskId + '.json')
  const attempts = [...(prior.record?.attempts ?? [])]
  let verification = prior.record?.verification ?? [...attempts].reverse().find((entry) => entry.verification)?.verification ?? null
  let status = 'failed'
  for (let attempt = attempts.length + 1; attempt <= loadedConfig.config.recovery.maxAttempts; attempt += 1) {
    const request = {
      schemaVersion: 1,
      task: { id: taskId, title: loadedTask.record.title, context: loadedTask.record.context, approvedPlan: loadedTask.record.plan },
      authority: { workspaceOnly: true, deployment: false, productionDatabase: false, networkApproved: options.allowNetwork === true },
      attempt,
      recovery: recoveryInput(verification)
    }
    await atomicJson(requestPath, request)
    const before = await captureConfiguredSourceBinding(workspace.path)
    const processResult = await runProcess({
      program: adapter.path,
      args: [...loadedConfig.config.adapter.command.slice(1), '--request', './' + relative(workspace.path, requestPath).replaceAll('\\', '/')],
      cwd: workspace.path,
      timeoutMs: loadedConfig.config.adapter.timeoutMs,
      env: { ...buildSafeEnvironment(), BTH_IMPLEMENTATION_REQUEST: requestPath, BTH_IMPLEMENTATION_ATTEMPT: String(attempt) }
    })
    const after = await captureConfiguredSourceBinding(workspace.path)
    const changed = before.fingerprint !== after.fingerprint
    const changedPaths = processPassed(processResult) ? await changedPathsAgainstHead(workspace.path) : []
    const protectedChanges = processPassed(processResult)
      ? protectedControlPlaneChanges(changedPaths, loadedConfig.config, verificationConfig)
      : []
    const writePolicy = processPassed(processResult)
      ? await evaluateWritePolicy(workspace.path, changedPaths, loadedConfig.config.writePolicy)
      : null
    const adapterPassed = processPassed(processResult) && changed && protectedChanges.length === 0 && writePolicy.passed
    const policyFailure = protectedChanges.length > 0 || (writePolicy && !writePolicy.passed)
    const attemptVerification = !processPassed(processResult)
      ? adapterFailureVerification(processResult, after.fingerprint)
      : policyFailure
        ? {
          confirmed: false,
          sourceFingerprint: after.fingerprint,
          runPath: null,
          failure: {
            code: protectedChanges.length > 0 ? 'protected_control_plane_changed' : 'write_policy_violated',
            message: protectedChanges.length > 0
              ? 'Implementation adapter changed protected verification control files: ' + protectedChanges.join(', ')
              : 'Implementation adapter violated the approved write policy: ' + writePolicy.reasons.join('; ')
          },
          tests: null,
          gates: []
        }
        : adapterPassed
          ? compactVerification(await checkProject(workspace.path, { allowNetwork: options.allowNetwork === true }))
          : null
    if (attemptVerification) verification = attemptVerification
    attempts.push({
      attempt,
      adapter: compactProcess(processResult),
      changed,
      writePolicy,
      sourceFingerprintBefore: before.fingerprint,
      sourceFingerprintAfter: after.fingerprint,
      outcome: !processPassed(processResult)
        ? 'adapter-failed'
        : policyFailure
          ? protectedChanges.length > 0 ? 'control-plane-change' : 'write-policy-violation'
          : !changed
            ? 'no-source-change'
            : attemptVerification.confirmed
              ? 'passed'
              : 'verification-failed',
      verification: attemptVerification
    })
    if (attemptVerification?.confirmed) { status = 'passed'; break }
  }
  const finalMainBinding = await captureConfiguredSourceBinding(root)
  if (finalMainBinding.fingerprint !== sourceBinding.fingerprint) throw new Error('Original worktree changed during isolated implementation; refusing to certify isolation.')
  const changedFiles = await workspaceStatus(workspace.path)
  const record = await saveRecord(prior.path, {
    schemaVersion: 1,
    taskId,
    adapter: loadedConfig.config.adapter.id,
    status,
    baseSourceFingerprint: sourceBinding.fingerprint,
    workspace: workspace.relativePath,
    attempts,
    verification,
    changedFiles,
    originalWorktreeUnchanged: true,
    updatedAt: new Date().toISOString(),
    nextAction: status === 'passed'
      ? 'Review the isolated diff, apply it through normal team Git workflow, then run bth verify on the integrated source.'
      : 'Inspect the isolated workspace and failure evidence before another bounded implementation run.'
  })
  return { root, path: relative(root, prior.path).replaceAll('\\', '/'), record }
}

export function runImplementation(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const root = await resolveReadableRoot(inputPath)
    return runUnlocked(root, taskId, options)
  })
}
