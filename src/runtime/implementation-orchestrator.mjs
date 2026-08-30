import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { loadImplementationConfig, resolveImplementationExecutable } from '../config/implementation.mjs'
import { loadVerificationConfig, verificationInputPaths } from '../config/verification.mjs'
import { canonicalJson } from '../core/canonical-json.mjs'
import {
  implementationIntegrationStatus,
  loadImplementationRecord,
  saveImplementationRecord,
  snapshotImplementedFiles
} from '../core/implementation-record-store.mjs'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'
import { advanceTask, loadTask, recordImplementationLifecycle } from '../core/task-store.mjs'
import { assertTaskId } from '../core/task-state.mjs'
import { assertNoSymlinkSegments, assertRelativeChild, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { captureConfiguredSourceBinding, checkProject } from './backend-harness.mjs'

const MAX_GIT_OUTPUT = 8 * 1024 * 1024

function runGit(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], { env: buildSafeEnvironment(), shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = [], stderr = []
    let bytes = 0, overflow = false
    const capture = (target) => (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_GIT_OUTPUT) {
        overflow = true
        child.kill('SIGTERM')
      } else {
        target.push(chunk)
      }
    }
    child.stdout.on('data', capture(stdout))
    child.stderr.on('data', capture(stderr))
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

async function workspaceStatus(worktree, baseCommit) {
  const [tracked, untracked] = await Promise.all([
    runGit(worktree, ['diff', '--name-only', '--no-renames', '-z', baseCommit, '--']),
    runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  ])
  const allPaths = [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()
  const paths = allPaths.slice(0, 4096)
  return {
    changedEntryCount: allPaths.length,
    truncated: allPaths.length > paths.length,
    paths,
    digest: createHash('sha256').update(tracked).update('\0').update(untracked).digest('hex')
  }
}

async function changedPathsAgainstBase(worktree, baseCommit) {
  const [tracked, untracked] = await Promise.all([
    runGit(worktree, ['diff', '--name-only', '--no-renames', '-z', baseCommit, '--']),
    runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  ])
  return [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort()
}

async function evaluateWritePolicy(worktree, baseCommit, paths, policy) {
  const outside = paths.filter((path) => !policy.allowedPrefixes.some((prefix) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix))
  const trackedDiff = await runGit(worktree, ['diff', '--binary', '--full-index', '--no-ext-diff', '--no-renames', baseCommit, '--'])
  const untracked = (await runGit(worktree, ['ls-files', '--others', '--exclude-standard', '-z', '--'])).split('\0').filter(Boolean)
  let untrackedBytes = 0
  const unsafeEntries = new Set()
  for (const path of paths) {
    const target = resolve(worktree, path)
    assertRelativeChild(worktree, target)
    const metadata = await statPath(target)
    if (metadata && (!metadata.isFile() || metadata.isSymbolicLink())) unsafeEntries.add(path)
  }
  for (const path of untracked) {
    const metadata = await statPath(resolve(worktree, path))
    if (!metadata?.isFile() || metadata.isSymbolicLink()) unsafeEntries.add(path)
    else untrackedBytes += metadata.size
  }
  const diffBytes = Buffer.byteLength(trackedDiff) + untrackedBytes
  const reasons = []
  if (outside.length > 0) reasons.push('outside allowed prefixes: ' + outside.join(', '))
  if (paths.length > policy.maxChangedFiles) reasons.push('changed files ' + paths.length + ' exceed ' + policy.maxChangedFiles)
  if (diffBytes > policy.maxDiffBytes) reasons.push('diff bytes ' + diffBytes + ' exceed ' + policy.maxDiffBytes)
  const unsafe = [...unsafeEntries].sort()
  if (unsafe.length > 0) reasons.push('non-regular changed entries: ' + unsafe.join(', '))
  return { passed: reasons.length === 0, changedFiles: paths.length, diffBytes, outside, unsafeEntries: unsafe, reasons }
}

function protectedControlPlaneChanges(paths, implementationConfig, verificationConfig) {
  const protectedPaths = new Set([
    '.backend-harness/implementation.json',
    '.backend-harness/project-rules.json',
    implementationConfig.adapter.command[0].replace(/^\.\//, ''),
    ...verificationInputPaths(verificationConfig).map((path) => path.replace(/^\.\//, ''))
  ])
  return paths.filter((path) => protectedPaths.has(path))
}

async function workspaceHead(worktree) {
  return (await runGit(worktree, ['rev-parse', 'HEAD'])).trim().toLowerCase()
}

async function sharedRefsSha256(worktree) {
  const refs = await runGit(worktree, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/tags'])
  return createHash('sha256').update(refs).digest('hex')
}

async function suspiciousIndexFlags(worktree) {
  const entries = (await runGit(worktree, ['ls-files', '-v', '-z'])).split('\0').filter(Boolean)
  return entries.flatMap((entry) => {
    const marker = entry[0]
    const path = entry.slice(2)
    const assumeUnchanged = /[a-z]/.test(marker)
    const skipWorktree = marker === 'S' || marker === 's'
    return assumeUnchanged || skipWorktree ? [{ marker, path }] : []
  })
}

async function implementationWorktreesRoot(root) {
  const canonicalHome = await realpath(homedir())
  const parent = resolve(canonicalHome, '.local/state/backend-team-harness/worktrees')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await assertNoSymlinkSegments(canonicalHome, parent)
  const parentMetadata = await lstat(parent)
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) throw new Error('Implementation worktree parent is unsafe.')
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && parentMetadata.uid !== process.getuid()) {
      throw new Error('Implementation worktree parent is not owned by the current user.')
    }
    if ((parentMetadata.mode & 0o077) !== 0) await chmod(parent, 0o700)
  }
  const canonicalParent = await realpath(parent)
  const projectKey = createHash('sha256').update(root).digest('hex').slice(0, 32)
  const worktreesRoot = resolve(canonicalParent, projectKey)
  await mkdir(worktreesRoot, { recursive: true, mode: 0o700 })
  const metadata = await lstat(worktreesRoot)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Implementation worktree root is unsafe.')
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
      throw new Error('Implementation worktree root is not owned by the current user.')
    }
    if ((metadata.mode & 0o077) !== 0) await chmod(worktreesRoot, 0o700)
  }
  await assertNoSymlinkSegments(canonicalParent, worktreesRoot)
  return worktreesRoot
}

async function resolveRecordedWorkspace(root, recordedPath) {
  if (typeof recordedPath !== 'string' || !recordedPath) throw new Error('Recorded implementation workspace path is invalid.')
  const worktreesRoot = await implementationWorktreesRoot(root)
  const path = resolve(recordedPath)
  assertRelativeChild(worktreesRoot, path)
  await assertNoSymlinkSegments(worktreesRoot, path)
  const metadata = await statPath(path)
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) throw new Error('Recorded implementation workspace is missing or unsafe.')
  return path
}

async function resolveRecordedWorkspaceForReset(root, recordedPath) {
  const path = resolve(recordedPath)
  const secureRoot = await implementationWorktreesRoot(root)
  const legacyRoot = resolve(tmpdir(), 'backend-team-harness-worktrees', createHash('sha256').update(root).digest('hex').slice(0, 32))
  const allowedRoot = [secureRoot, legacyRoot].find((candidate) => {
    try {
      assertRelativeChild(candidate, path)
      return true
    } catch {
      return false
    }
  })
  if (!allowedRoot) throw new Error('Recorded implementation workspace is outside every recognized harness workspace root.')
  const metadata = await statPath(path)
  if (!metadata) return null
  await assertNoSymlinkSegments(allowedRoot, path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Recorded implementation workspace is unsafe.')
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
    throw new Error('Recorded implementation workspace is not owned by the current user.')
  }
  return path
}

async function allocateWorkspace(root, taskId) {
  const worktreesRoot = await implementationWorktreesRoot(root)
  const name = taskId.toLowerCase().replace(/[^a-z0-9._-]/g, '-') + '-' + randomUUID().slice(0, 8)
  const worktree = resolve(worktreesRoot, name)
  return { path: worktree, recordPath: worktree }
}

async function materializeWorkspace(root, workspace, sourceBinding) {
  await runGit(root, ['worktree', 'add', '--detach', workspace.path, sourceBinding.headCommit])
}

async function stageMissingVerificationInputs(root, worktree, verificationConfig) {
  for (const path of verificationInputPaths(verificationConfig)) {
    const source = await resolveSafeProjectPath(root, path)
    const target = await resolveSafeProjectPath(worktree, path)
    if (await statPath(target)) continue
    const metadata = await statPath(source)
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Declared verification input is unavailable in the isolated workspace: ' + path)
    }
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyFile(source, target)
    if (process.platform !== 'win32') await chmod(target, metadata.mode & 0o777)
  }
}

async function captureImplementationBinding(root, verificationConfig) {
  try {
    return {
      binding: await captureSourceBinding(root, {
        explicitPaths: verificationInputPaths(verificationConfig),
        allowSymlinkPaths: verificationConfig.gates.map((gate) => gate.command[0])
      }),
      error: null
    }
  } catch (error) {
    return {
      binding: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function implementationStatus(inputPath, taskId) {
  const root = await resolveReadableRoot(inputPath)
  const id = assertTaskId(taskId)
  const loaded = await loadImplementationRecord(root, id)
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
  const sourceVerificationConfig = (await loadVerificationConfig(root)).config
  if (!loadedConfig.config.adapter) throw new Error('Implementation adapter is disabled. Configure .backend-harness/implementation.json first.')
  if (loadedConfig.config.adapter.network && options.allowNetwork !== true) throw new Error('Implementation adapter declares network access; pass --allow-network explicitly.')
  if (options.allowWrite !== true) throw new Error('Implementation changes require explicit --allow-write approval.')

  const sourceBinding = await captureConfiguredSourceBinding(root)
  const baseRefsSha256 = await sharedRefsSha256(root)
  const acceptedFingerprints = new Set([sourceBinding.fingerprint, sourceBinding.legacyFingerprint].filter(Boolean))
  if (!sourceBinding.clean) throw new Error('Implementation requires a clean source-bound worktree. Commit or stash source changes first.')
  if (sourceBinding.projectPath !== '.') {
    throw new Error('Isolated implementation currently requires the harness project root to be the Git top-level. Monorepo subdirectory projects are rejected explicitly until path-scoped worktree evidence is supported.')
  }
  if (!acceptedFingerprints.has(loadedTask.record.planSourceFingerprint) || !acceptedFingerprints.has(loadedTask.record.approvalReceipt.sourceFingerprint)) {
    throw new Error('Approved plan source is stale. Rebind and approve the plan against the current source.')
  }

  const prior = await loadImplementationRecord(root, taskId)
  if (prior.record?.baseSourceFingerprint && prior.record.baseSourceFingerprint !== sourceBinding.fingerprint) {
    throw new Error('Existing implementation record belongs to a different source fingerprint.')
  }
  if (prior.record?.baseRefsSha256 && prior.record.baseRefsSha256 !== baseRefsSha256) {
    throw new Error('Shared Git branch or tag refs changed since the implementation run started; reset and re-approve before continuing.')
  }
  if (prior.record?.attempts?.at(-1)?.outcome === 'gate-integrity-failure') {
    throw new Error('A verification Gate changed the isolated implementation inventory or Git metadata. Reset the tainted workspace before another implementation run.')
  }
  if (prior.record?.status === 'passed') {
    if (prior.record.schemaVersion !== 2 || !prior.record.baseHeadCommit || !Array.isArray(prior.record.implementedFiles) || prior.record.implementedFiles.length < 1) {
      throw new Error('Legacy passed implementation record lacks file-level integration evidence. Run `bth implement reset ' + taskId + ' --by <actor> --discard-workspace` before rebuilding it.')
    }
    return { root, path: relative(root, prior.path).replaceAll('\\', '/'), record: prior.record }
  }
  if ((prior.record?.attempts?.length ?? 0) >= loadedConfig.config.recovery.maxAttempts) {
    throw new Error('Implementation recovery budget is exhausted for task ' + taskId + '; inspect the recorded evidence and start a newly approved task or increase the explicit budget.')
  }
  let workspace
  if (prior.record) {
    const path = await resolveRecordedWorkspace(root, prior.record.workspace)
    workspace = { path, recordPath: prior.record.workspace }
  } else {
    workspace = await allocateWorkspace(root, taskId)
    const worktreeRelative = relative(root, workspace.path)
    await saveImplementationRecord(prior.path, {
      schemaVersion: 2,
      taskId,
      adapter: loadedConfig.config.adapter.id,
      status: 'running',
      baseSourceFingerprint: sourceBinding.fingerprint,
      baseHeadCommit: sourceBinding.headCommit,
      baseExplicitInputs: sourceBinding.explicitInputs,
      baseRefsSha256,
      workspace: workspace.recordPath,
      attempts: [],
      verification: null,
      changedFiles: null,
      implementedFiles: [],
      originalBoundSourceUnchanged: null,
      isolation: {
        worktreeOutsideProject: worktreeRelative === '..' || worktreeRelative.startsWith('../') || worktreeRelative.startsWith('..\\'),
        boundSourceFingerprintChecked: false,
        osSandbox: false
      },
      updatedAt: new Date().toISOString(),
      nextAction: 'Implementation workspace allocation is in progress. A failed or interrupted allocation can be removed with bth implement reset.'
    })
  }

  if (loadedTask.record.state === 'PLAN_APPROVED') {
    const transition = await advanceTask(root, taskId, 'IMPLEMENTING', {
      actor: options.actor,
      reason: 'Started isolated implementation workspace.',
      implementationMode: 'isolated'
    })
    if (!transition.applied) throw new Error('Could not advance task to IMPLEMENTING: ' + transition.audit.reason)
  }
  if (!prior.record) await materializeWorkspace(root, workspace, sourceBinding)
  await stageMissingVerificationInputs(root, workspace.path, sourceVerificationConfig)
  if (await workspaceHead(workspace.path) !== sourceBinding.headCommit) {
    throw new Error('Implementation workspace history moved away from its immutable base commit.')
  }
  const preexistingIndexFlags = await suspiciousIndexFlags(workspace.path)
  if (preexistingIndexFlags.length > 0) {
    throw new Error('Implementation workspace contains assume-unchanged or skip-worktree index flags: ' + preexistingIndexFlags.slice(0, 16).map((entry) => entry.path).join(', '))
  }

  const adapter = await resolveImplementationExecutable(workspace.path, loadedConfig.config.adapter.command)
  const verificationConfig = (await loadVerificationConfig(workspace.path)).config
  const requestDir = await resolveSafeProjectPath(workspace.path, '.backend-harness/local/implementation')
  await mkdir(requestDir, { recursive: true, mode: 0o700 })
  const requestPath = resolve(requestDir, 'request-' + taskId + '.json')
  const attempts = [...(prior.record?.attempts ?? [])]
  let verification = prior.record?.verification ?? [...attempts].reverse().find((entry) => entry.verification)?.verification ?? null
  let status = 'failed'
  let certifiedImplementedFiles = []
  for (let attempt = attempts.length + 1; attempt <= loadedConfig.config.recovery.maxAttempts; attempt += 1) {
    const request = {
      schemaVersion: 1,
      task: { id: taskId, title: loadedTask.record.title, context: loadedTask.record.context, approvedPlan: loadedTask.record.plan },
      authority: { workspaceOnly: true, deployment: false, productionDatabase: false, networkApproved: options.allowNetwork === true },
      attempt,
      recovery: recoveryInput(verification)
    }
    await atomicJson(requestPath, request)
    const beforeCapture = await captureImplementationBinding(workspace.path, verificationConfig)
    const processResult = await runProcess({
      program: adapter.path,
      args: [...loadedConfig.config.adapter.command.slice(1), '--request', './' + relative(workspace.path, requestPath).replaceAll('\\', '/')],
      cwd: workspace.path,
      timeoutMs: loadedConfig.config.adapter.timeoutMs,
      env: { ...buildSafeEnvironment(), BTH_IMPLEMENTATION_REQUEST: requestPath, BTH_IMPLEMENTATION_ATTEMPT: String(attempt) }
    })
    const afterCapture = await captureImplementationBinding(workspace.path, verificationConfig)
    const after = afterCapture.binding
    const headAfter = await workspaceHead(workspace.path)
    const historyChanged = headAfter !== sourceBinding.headCommit
    const sharedRefsChanged = await sharedRefsSha256(workspace.path) !== baseRefsSha256
    const indexFlagChanges = await suspiciousIndexFlags(workspace.path)
    const declaredInputsChanged = !after || JSON.stringify(sourceBinding.explicitInputs) !== JSON.stringify(after.explicitInputs)
    const changedPaths = processPassed(processResult) ? await changedPathsAgainstBase(workspace.path, sourceBinding.headCommit) : []
    const changed = changedPaths.length > 0
    const protectedChanges = processPassed(processResult)
      ? protectedControlPlaneChanges(changedPaths, loadedConfig.config, verificationConfig)
      : []
    const writePolicy = processPassed(processResult)
      ? await evaluateWritePolicy(workspace.path, sourceBinding.headCommit, changedPaths, loadedConfig.config.writePolicy)
      : null
    const adapterPassed = processPassed(processResult) && !afterCapture.error && !historyChanged && !sharedRefsChanged && indexFlagChanges.length === 0 && !declaredInputsChanged && changed && protectedChanges.length === 0 && writePolicy.passed
    const policyFailure = Boolean(afterCapture.error) || historyChanged || sharedRefsChanged || indexFlagChanges.length > 0 || declaredInputsChanged || protectedChanges.length > 0 || (writePolicy && !writePolicy.passed)
    let candidateFiles = []
    let attemptVerification
    let gateIntegrityFailure = false
    if (!processPassed(processResult)) {
      attemptVerification = adapterFailureVerification(processResult, after?.fingerprint ?? null)
    } else if (policyFailure) {
      attemptVerification = {
          confirmed: false,
          sourceFingerprint: after?.fingerprint ?? null,
          runPath: null,
          failure: {
            code: afterCapture.error
              ? 'implementation_source_binding_failed'
              : historyChanged
                ? 'implementation_workspace_history_changed'
                : sharedRefsChanged
                  ? 'implementation_shared_refs_changed'
                : indexFlagChanges.length > 0
                  ? 'implementation_index_flags_changed'
                : declaredInputsChanged
                  ? 'declared_verification_input_changed'
                  : protectedChanges.length > 0
                    ? 'protected_control_plane_changed'
                    : 'write_policy_violated',
            message: afterCapture.error
              ? 'Implementation source binding failed after the adapter ran: ' + afterCapture.error
              : historyChanged
                ? 'Implementation adapter changed the isolated workspace Git history; commits are reserved for the normal team Git workflow.'
                : sharedRefsChanged
                  ? 'Implementation adapter changed shared Git branch or tag refs.'
                : indexFlagChanges.length > 0
                  ? 'Implementation adapter set assume-unchanged or skip-worktree flags: ' + indexFlagChanges.slice(0, 16).map((entry) => entry.path).join(', ')
                : declaredInputsChanged
                  ? 'Implementation adapter changed a declared verification input; ignored control-plane files cannot be modified during implementation.'
                  : protectedChanges.length > 0
                    ? 'Implementation adapter changed protected verification control files: ' + protectedChanges.join(', ')
                    : 'Implementation adapter violated the approved write policy: ' + writePolicy.reasons.join('; ')
          },
          tests: null,
          gates: []
        }
    } else if (adapterPassed) {
      candidateFiles = await snapshotImplementedFiles(workspace.path, changedPaths)
      const checked = compactVerification(await checkProject(workspace.path, { allowNetwork: options.allowNetwork === true }))
      const postGateFiles = await snapshotImplementedFiles(workspace.path, changedPaths)
      const postGateChangedPaths = await changedPathsAgainstBase(workspace.path, sourceBinding.headCommit)
      const postGateIndexFlags = await suspiciousIndexFlags(workspace.path)
      const postGateRefsChanged = await sharedRefsSha256(workspace.path) !== baseRefsSha256
      const postGateInventoryChanged = canonicalJson(changedPaths) !== canonicalJson(postGateChangedPaths)
      if (canonicalJson(candidateFiles) !== canonicalJson(postGateFiles) || postGateInventoryChanged || postGateIndexFlags.length > 0 || postGateRefsChanged) {
        gateIntegrityFailure = true
        attemptVerification = {
          confirmed: false,
          sourceFingerprint: checked.sourceFingerprint,
          runPath: checked.runPath,
          failure: {
            code: postGateRefsChanged
              ? 'verification_gate_changed_shared_refs'
              : postGateIndexFlags.length > 0
                ? 'verification_gate_changed_index_flags'
                : postGateInventoryChanged
                  ? 'verification_gate_changed_inventory'
                : 'verification_gate_modified_candidate',
            message: postGateRefsChanged
              ? 'A verification Gate changed shared Git branch or tag refs.'
              : postGateIndexFlags.length > 0
                ? 'A verification Gate set assume-unchanged or skip-worktree index flags.'
                : postGateInventoryChanged
                  ? 'A verification Gate added or removed source paths; only the exact pre-Gate implementation inventory can be certified.'
                : 'A verification Gate changed a candidate implementation path; pre-Gate implementation bytes cannot be certified.'
          },
          tests: checked.tests,
          gates: checked.gates
        }
      } else {
        attemptVerification = checked
      }
    } else {
      attemptVerification = null
    }
    if (attemptVerification) verification = attemptVerification
    attempts.push({
      attempt,
      adapter: compactProcess(processResult),
      changed,
      writePolicy,
      sourceFingerprintBefore: beforeCapture.binding?.fingerprint ?? null,
      sourceFingerprintAfter: after?.fingerprint ?? null,
      outcome: !processPassed(processResult)
        ? 'adapter-failed'
        : policyFailure
          ? afterCapture.error
            ? 'source-binding-failed'
            : historyChanged
            ? 'workspace-history-change'
            : sharedRefsChanged
              ? 'shared-refs-change'
            : indexFlagChanges.length > 0
              ? 'index-flags-change'
            : declaredInputsChanged || protectedChanges.length > 0 ? 'control-plane-change' : 'write-policy-violation'
          : !changed
            ? 'no-source-change'
            : gateIntegrityFailure
              ? 'gate-integrity-failure'
            : attemptVerification.confirmed
              ? 'passed'
              : 'verification-failed',
      verification: attemptVerification
    })
    if (gateIntegrityFailure) break
    if (attemptVerification?.confirmed) {
      status = 'passed'
      certifiedImplementedFiles = candidateFiles
      break
    }
  }
  const finalMainCapture = await captureImplementationBinding(root, sourceVerificationConfig)
  const finalMainBinding = finalMainCapture.binding
  const originalBoundSourceUnchanged = finalMainBinding?.fingerprint === sourceBinding.fingerprint
  if (!originalBoundSourceUnchanged) {
    status = 'failed'
    if (attempts.length > 0) {
      attempts[attempts.length - 1] = {
        ...attempts.at(-1),
        outcome: 'original-source-change'
      }
    }
    verification = {
      confirmed: false,
      sourceFingerprint: finalMainBinding?.fingerprint ?? null,
      runPath: null,
      failure: {
        code: 'original_bound_source_changed',
        message: finalMainCapture.error
          ? 'The original bound source could not be rebound after isolated implementation: ' + finalMainCapture.error
          : 'The original bound source changed while the isolated implementation was running; the harness recorded the breach and refuses certification.'
      },
      tests: null,
      gates: []
    }
  }
  const changedFiles = await workspaceStatus(workspace.path, sourceBinding.headCommit)
  const implementedFiles = status === 'passed'
    ? certifiedImplementedFiles
    : []
  const worktreeRelative = relative(root, workspace.path)
  const record = await saveImplementationRecord(prior.path, {
    schemaVersion: 2,
    taskId,
    adapter: loadedConfig.config.adapter.id,
    status,
    baseSourceFingerprint: sourceBinding.fingerprint,
    baseHeadCommit: sourceBinding.headCommit,
    baseExplicitInputs: sourceBinding.explicitInputs,
    baseRefsSha256,
    workspace: workspace.recordPath,
    attempts,
    verification,
    changedFiles,
    implementedFiles,
    originalBoundSourceUnchanged,
    isolation: {
      worktreeOutsideProject: worktreeRelative === '..' || worktreeRelative.startsWith('../') || worktreeRelative.startsWith('..\\'),
      boundSourceFingerprintChecked: true,
      osSandbox: false
    },
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

export function resetImplementation(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const root = await resolveReadableRoot(inputPath)
    const id = assertTaskId(taskId)
    if (typeof options.actor !== 'string' || !options.actor.trim()) throw new Error('Implementation reset requires an actor.')
    if (options.discardWorkspace !== true) throw new Error('Implementation reset requires explicit --discard-workspace approval.')
    await loadTask(root, id)
    const prior = await loadImplementationRecord(root, id)
    if (!prior.record) throw new Error('No implementation run exists for task ' + id + '.')

    const workspace = await resolveRecordedWorkspaceForReset(root, prior.record.workspace)
    if (workspace) {
      try {
        const checkoutRoot = (await runGit(workspace, ['rev-parse', '--show-toplevel'])).trim()
        const secureRoot = await implementationWorktreesRoot(root)
        const legacyRoot = resolve(tmpdir(), 'backend-team-harness-worktrees', createHash('sha256').update(root).digest('hex').slice(0, 32))
        const contained = [secureRoot, legacyRoot].some((candidate) => {
          try { assertRelativeChild(candidate, checkoutRoot); return true } catch { return false }
        })
        if (!contained) throw new Error('Implementation checkout root is outside every recognized harness workspace root.')
        await runGit(root, ['worktree', 'remove', '--force', checkoutRoot])
      } catch (error) {
        if (/outside every recognized harness workspace root/.test(error instanceof Error ? error.message : String(error))) throw error
        await rm(workspace, { recursive: true, force: true })
      }
    }
    await runGit(root, ['worktree', 'prune'])

    const archiveDir = await resolveSafeProjectPath(root, '.backend-harness/local/implementation/archive')
    await mkdir(archiveDir, { recursive: true, mode: 0o700 })
    const archivePath = resolve(archiveDir, id + '-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json')
    await rename(prior.path, archivePath)
    const resetAt = new Date().toISOString()
    const receiptUnsigned = {
      schemaVersion: 1,
      type: 'implementation_reset',
      taskId: id,
      actor: options.actor.trim(),
      resetAt,
      discardedWorkspace: prior.record.workspace,
      archivedRecord: relative(root, archivePath).replaceAll('\\', '/'),
      archivedRecordSha256: prior.record.recordSha256
    }
    const receipt = {
      ...receiptUnsigned,
      recordSha256: createHash('sha256').update(canonicalJson(receiptUnsigned)).digest('hex')
    }
    const receiptPath = archivePath.replace(/\.json$/, '.reset.json')
    await atomicJson(receiptPath, receipt)
    await recordImplementationLifecycle(root, id, 'reset', {
      actor: options.actor.trim(),
      artifact: relative(root, receiptPath).replaceAll('\\', '/'),
      recordSha256: receipt.recordSha256,
      at: resetAt
    })
    return {
      root,
      taskId: id,
      actor: options.actor.trim(),
      archivedRecord: relative(root, archivePath).replaceAll('\\', '/'),
      resetReceipt: relative(root, receiptPath).replaceAll('\\', '/'),
      workspaceRemoved: Boolean(workspace),
      nextAction: 'Run bth implement run again with fresh explicit write approval, or revise and re-approve the plan first.'
    }
  })
}

export function cleanupImplementation(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const root = await resolveReadableRoot(inputPath)
    const id = assertTaskId(taskId)
    if (typeof options.actor !== 'string' || !options.actor.trim()) throw new Error('Implementation cleanup requires an actor.')
    if (options.discardWorkspace !== true) throw new Error('Implementation cleanup requires explicit --discard-workspace approval.')
    const loadedTask = await loadTask(root, id)
    if (!['VERIFIED', 'DONE'].includes(loadedTask.record.state)) {
      throw new Error('Implementation cleanup requires task state VERIFIED or DONE; review and integrate the isolated diff first.')
    }
    const prior = await loadImplementationRecord(root, id)
    if (!prior.record || prior.record.status !== 'passed') throw new Error('Implementation cleanup requires a passed sealed implementation record.')
    if (!prior.record.workspace) throw new Error('Implementation workspace was already removed.')
    const currentSourceBinding = await captureConfiguredSourceBinding(root)
    const integration = await implementationIntegrationStatus(root, prior.record, { currentSourceBinding })
    if (!integration.integrated) throw new Error('Implementation cleanup requires the bound source to match the passed file evidence.')

    const workspace = await resolveRecordedWorkspaceForReset(root, prior.record.workspace)
    if (workspace) {
      const checkoutRoot = (await runGit(workspace, ['rev-parse', '--show-toplevel'])).trim()
      const secureRoot = await implementationWorktreesRoot(root)
      const legacyRoot = resolve(tmpdir(), 'backend-team-harness-worktrees', createHash('sha256').update(root).digest('hex').slice(0, 32))
      const contained = [secureRoot, legacyRoot].some((candidate) => {
        try { assertRelativeChild(candidate, checkoutRoot); return true } catch { return false }
      })
      if (!contained) throw new Error('Implementation checkout root is outside every recognized harness workspace root.')
      await runGit(root, ['worktree', 'remove', '--force', checkoutRoot])
    }
    await runGit(root, ['worktree', 'prune'])

    const archiveDir = await resolveSafeProjectPath(root, '.backend-harness/local/implementation/archive')
    await mkdir(archiveDir, { recursive: true, mode: 0o700 })
    const archivePath = resolve(archiveDir, id + '-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json')
    await rename(prior.path, archivePath)
    const { recordSha256: previousRecordSha256, ...unsigned } = prior.record
    const cleanedAt = new Date().toISOString()
    const record = await saveImplementationRecord(prior.path, {
      ...unsigned,
      workspace: null,
      workspaceCleanup: {
        actor: options.actor.trim(),
        cleanedAt,
        previousRecordSha256,
        archivedRecord: relative(root, archivePath).replaceAll('\\', '/')
      },
      updatedAt: cleanedAt,
      nextAction: 'The isolated workspace was removed after integration and verified evidence; retain the archived sealed record for audit.'
    })
    await recordImplementationLifecycle(root, id, 'cleanup', {
      actor: options.actor.trim(),
      artifact: relative(root, archivePath).replaceAll('\\', '/'),
      recordSha256: record.recordSha256,
      at: cleanedAt
    })
    return {
      root,
      taskId: id,
      record,
      archivedRecord: relative(root, archivePath).replaceAll('\\', '/'),
      workspaceRemoved: Boolean(workspace)
    }
  })
}
