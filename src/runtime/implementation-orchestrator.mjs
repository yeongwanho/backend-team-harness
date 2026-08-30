import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, relative, resolve } from 'node:path'
import { loadImplementationConfig, resolveImplementationExecutable } from '../config/implementation.mjs'
import { loadVerificationConfig, verificationExecutablePaths, verificationInputPaths } from '../config/verification.mjs'
import { selectVerificationGates } from '../adapters/verification-tool.mjs'
import { canonicalJson } from '../core/canonical-json.mjs'
import {
  implementationIntegrationStatus,
  loadImplementationRecord,
  saveImplementationRecord,
  snapshotImplementedFiles
} from '../core/implementation-record-store.mjs'
import { buildSafeEnvironment, runProcess } from '../core/process-runner.mjs'
import { implementationStateDirectory } from '../core/platform.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { captureSourceBinding } from '../core/source-binding.mjs'
import { advanceTask, loadTask, recordImplementationLifecycle } from '../core/task-store.mjs'
import { assertTaskId } from '../core/task-state.mjs'
import { loadInterview } from '../core/interview-store.mjs'
import { loadBudgetedCodeContext } from '../core/code-context.mjs'
import { inspectBoundSourceCodeContext } from '../adapters/bounded-code-context.mjs'
import { buildProjectConventions, projectRuleReadiness } from '../core/project-conventions.mjs'
import { selectProviderContext } from '../core/provider-context.mjs'
import { assertNoSymlinkSegments, assertRelativeChild, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { captureConfiguredSourceBinding, checkProject } from './backend-harness.mjs'
import {
  probeImplementationProvider,
  runImplementationProvider,
  selectImplementationProfile
} from '../providers/model-cli.mjs'

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

async function atomicJson(path, value, compact = false) {
  const temporary = resolve(dirname(path), '.bth-' + randomUUID() + '.tmp')
  const content = JSON.stringify(value, null, compact ? undefined : 2) + '\n'
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return {
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex')
  }
}

async function requestIntegrity(path, expected) {
  const metadata = await statPath(path)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== expected.bytes || metadata.size > 1024 * 1024) {
    return { unchanged: false, bytes: metadata?.size ?? null, sha256: null }
  }
  const content = await readFile(path)
  const sha256 = createHash('sha256').update(content).digest('hex')
  return { unchanged: sha256 === expected.sha256, bytes: content.length, sha256 }
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

const NON_RETRYABLE_PROVIDER_FAILURES = new Set([
  'not-authenticated',
  'budget-exhausted',
  'rate-limited',
  'cli-incompatible'
])

function providerFailureIsNonRetryable(adapterRun) {
  return NON_RETRYABLE_PROVIDER_FAILURES.has(adapterRun.metadata?.failure?.code)
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

function adapterFailureVerification(result, sourceFingerprint, providerFailure = null) {
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
      message: providerFailure?.message ?? ('The configured implementation adapter ' + reason + '.'),
      providerFailure
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

async function candidateIntegrity(worktree, sourceBinding, baseRefsSha256, changedPaths, candidateFiles) {
  const [files, paths, indexFlags, refsSha256] = await Promise.all([
    snapshotImplementedFiles(worktree, changedPaths),
    changedPathsAgainstBase(worktree, sourceBinding.headCommit),
    suspiciousIndexFlags(worktree),
    sharedRefsSha256(worktree)
  ])
  return {
    valid: canonicalJson(candidateFiles) === canonicalJson(files) &&
      canonicalJson(changedPaths) === canonicalJson(paths) &&
      indexFlags.length === 0 && refsSha256 === baseRefsSha256,
    filesChanged: canonicalJson(candidateFiles) !== canonicalJson(files),
    inventoryChanged: canonicalJson(changedPaths) !== canonicalJson(paths),
    indexFlags,
    refsChanged: refsSha256 !== baseRefsSha256
  }
}

function candidateIntegrityFailure(checked, integrity) {
  return {
    confirmed: false,
    sourceFingerprint: checked.sourceFingerprint,
    runPath: checked.runPath,
    failure: {
      code: integrity.refsChanged
        ? 'verification_gate_changed_shared_refs'
        : integrity.indexFlags.length > 0
          ? 'verification_gate_changed_index_flags'
          : integrity.inventoryChanged
            ? 'verification_gate_changed_inventory'
            : 'verification_gate_modified_candidate',
      message: integrity.refsChanged
        ? 'A verification Gate changed shared Git branch or tag refs.'
        : integrity.indexFlags.length > 0
          ? 'A verification Gate set assume-unchanged or skip-worktree index flags.'
          : integrity.inventoryChanged
            ? 'A verification Gate added or removed source paths; only the exact pre-Gate implementation inventory can be certified.'
            : 'A verification Gate changed a candidate implementation path; pre-Gate implementation bytes cannot be certified.'
    },
    tests: checked.tests,
    gates: checked.gates
  }
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
    ...verificationInputPaths(verificationConfig).map((path) => path.replace(/^\.\//, ''))
  ])
  if (implementationConfig.adapter.kind === 'command') {
    protectedPaths.add(implementationConfig.adapter.command[0].replace(/^\.\//, ''))
  }
  return paths.filter((path) => path === '.backend-harness' || path.startsWith('.backend-harness/') || protectedPaths.has(path))
}

function planQuery(task) {
  return [task.title, task.context, task.plan].filter((value) => typeof value === 'string').join('\n').slice(0, 64 * 1024)
}

function providerTaskPayload(task) {
  const payload = { id: task.id, title: task.title, context: task.context, approvedPlan: task.plan }
  const characters = Object.values(payload).reduce((total, value) => total + (typeof value === 'string' ? value.length : 0), 0)
  return { payload, characters }
}

async function structuredImplementationContext(root, task) {
  const fallback = {
    claims: {},
    projectRuleEvaluation: {
      schemaVersion: 1, status: 'unknown', blocking: false,
      counts: { confirmed: 0, unknown: 0, conflict: 0 }, results: []
    },
    knowledge: { complete: false, documents: [] },
    conventions: { status: 'unknown', modules: [], layers: [] }
  }
  if (!task.planArtifactSha256) return fallback
  const interview = await loadInterview(root, task.id)
  const claims = {}
  for (const answer of interview.record.answers ?? []) Object.assign(claims, answer.claims ?? {})
  if (!Array.isArray(claims.requiredGates) && Array.isArray(interview.artifacts?.plan?.declaredRequiredGates)) {
    claims.requiredGates = [...interview.artifacts.plan.declaredRequiredGates]
  }
  return {
    claims,
    projectRuleEvaluation: interview.artifacts?.plan?.projectRuleEvaluation ?? fallback.projectRuleEvaluation,
    knowledge: interview.contextSnapshot?.intelligence?.knowledge ?? fallback.knowledge,
    conventions: interview.contextSnapshot?.intelligence?.conventions ?? fallback.conventions
  }
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
  const requestedStateRoot = implementationStateDirectory()
  await mkdir(requestedStateRoot, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32' && !(typeof process.env.XDG_STATE_HOME === 'string' && process.env.XDG_STATE_HOME.trim())) {
    await assertNoSymlinkSegments(await realpath(homedir()), requestedStateRoot)
  }
  const stateMetadata = await lstat(requestedStateRoot)
  if (!stateMetadata.isDirectory() || stateMetadata.isSymbolicLink()) throw new Error('Implementation state root is unsafe.')
  const canonicalStateRoot = await realpath(requestedStateRoot)
  const parent = resolve(canonicalStateRoot, 'worktrees')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await assertNoSymlinkSegments(canonicalStateRoot, parent)
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

export async function resolveRecordedWorkspace(root, recordedPath) {
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
        allowSymlinkPaths: verificationExecutablePaths(verificationConfig)
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

async function prepareProviderPlanning(root, task, config, sourceBinding) {
  if (config.adapter.kind !== 'provider') {
    return { providerTask: null, planningContext: null, profile: null, codeContext: null, projectConventions: null }
  }
  const providerTask = providerTaskPayload(task)
  const planningContext = await structuredImplementationContext(root, task)
  const profileInput = {
    mode: config.adapter.mode,
    contextBudgetCharacters: config.adapter.contextBudgetCharacters,
    taskCharacters: providerTask.characters,
    claims: planningContext.claims,
    projectRuleReadiness: projectRuleReadiness(planningContext.projectRuleEvaluation),
    conventionsReady: planningContext.conventions?.status === 'observed'
  }
  let profile = selectImplementationProfile(profileInput)
  const conventionModules = (planningContext.conventions?.modules ?? []).filter((module) => module !== 'root')
  const codegraphProjectPath = conventionModules.length === 1 ? conventionModules[0] : '.'
  const loadContext = async (budgetCharacters) => {
    const persisted = await loadBudgetedCodeContext(root, planQuery(task), {
      budgetCharacters,
      sourceFingerprint: sourceBinding.fingerprint
    })
    if (persisted.status === 'available') return persisted
    return inspectBoundSourceCodeContext(root, planQuery(task), {
      budgetCharacters,
      sourceFingerprint: sourceBinding.fingerprint,
      indexerOptions: { projectPath: codegraphProjectPath }
    })
  }
  let codeContext = await loadContext(profile.contextBudgetCharacters)
  let currentSource = await captureConfiguredSourceBinding(root)
  if (currentSource.fingerprint !== sourceBinding.fingerprint) {
    throw new Error('Project source changed while the bounded implementation context was being inspected; restart from the new source.')
  }
  let projectConventions = buildProjectConventions(planningContext.projectRuleEvaluation, planningContext.knowledge, codeContext, planningContext.conventions)
  if (config.adapter.mode === 'auto' && profile.selected === 'fast') {
    profile = selectImplementationProfile({ ...profileInput, adjacentCodeReady: projectConventions.adjacentCode.status === 'confirmed' })
    if (profile.selected !== 'fast') {
      codeContext = await loadContext(profile.contextBudgetCharacters)
      currentSource = await captureConfiguredSourceBinding(root)
      if (currentSource.fingerprint !== sourceBinding.fingerprint) {
        throw new Error('Project source changed while the bounded implementation context was being inspected; restart from the new source.')
      }
      projectConventions = buildProjectConventions(planningContext.projectRuleEvaluation, planningContext.knowledge, codeContext, planningContext.conventions)
    }
  }
  const selectedContext = selectProviderContext(codeContext, projectConventions, profile.selected)
  return { providerTask, planningContext, profile, ...selectedContext }
}

function assertApprovedSource(task, sourceBinding) {
  const acceptedFingerprints = new Set([sourceBinding.fingerprint, sourceBinding.legacyFingerprint].filter(Boolean))
  if (!sourceBinding.clean) throw new Error('Implementation requires a clean source-bound worktree. Commit or stash source changes first.')
  if (sourceBinding.projectPath !== '.') {
    throw new Error('Isolated implementation currently requires the harness project root to be the Git top-level. Monorepo subdirectory projects are rejected explicitly until path-scoped worktree evidence is supported.')
  }
  if (!acceptedFingerprints.has(task.planSourceFingerprint) || !acceptedFingerprints.has(task.approvalReceipt.sourceFingerprint)) {
    throw new Error('Approved plan source is stale. Rebind and approve the plan against the current source.')
  }
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
  if (loadedConfig.config.adapter.network && options.allowNetwork !== true) throw new Error('Implementation adapter may use the network; pass --acknowledge-network-risk explicitly. BTH does not isolate operating-system egress.')
  if (options.allowWrite !== true) throw new Error('Implementation changes require explicit --allow-write approval.')
  const providerProbe = loadedConfig.config.adapter.kind === 'provider'
    ? await (options.providerProbe ?? probeImplementationProvider)(loadedConfig.config.adapter.provider, { cwd: root })
    : null
  if (providerProbe && providerProbe.available !== true) {
    throw new Error('Implementation provider is unavailable: ' + loadedConfig.config.adapter.provider)
  }

  const sourceBinding = await captureConfiguredSourceBinding(root)
  const { providerTask, profile, codeContext, projectConventions } = await prepareProviderPlanning(
    root, loadedTask.record, loadedConfig.config, sourceBinding
  )
  const baseRefsSha256 = await sharedRefsSha256(root)
  assertApprovedSource(loadedTask.record, sourceBinding)

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
      adapterKind: loadedConfig.config.adapter.kind,
      provider: providerProbe ? {
        id: loadedConfig.config.adapter.provider,
        version: providerProbe.version,
        profile
      } : null,
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

  const adapter = loadedConfig.config.adapter.kind === 'command'
    ? await resolveImplementationExecutable(workspace.path, loadedConfig.config.adapter.command)
    : null
  const verificationConfig = (await loadVerificationConfig(workspace.path)).config
  const requestDir = await resolveSafeProjectPath(workspace.path, '.backend-harness/local/implementation')
  await mkdir(requestDir, { recursive: true, mode: 0o700 })
  const requestPath = resolve(requestDir, 'request-' + taskId + '.json')
  const attempts = [...(prior.record?.attempts ?? [])]
  let verification = prior.record?.verification ?? [...attempts].reverse().find((entry) => entry.verification)?.verification ?? null
  let status = 'failed'
  let certifiedImplementedFiles = []
  for (let attempt = attempts.length + 1; attempt <= loadedConfig.config.recovery.maxAttempts; attempt += 1) {
    const task = providerTask?.payload ?? {
      id: taskId,
      title: loadedTask.record.title,
      context: loadedTask.record.context,
      approvedPlan: loadedTask.record.plan
    }
    const request = loadedConfig.config.schemaVersion === 1
      ? {
          schemaVersion: 1,
          task,
          // Legacy schema v1 keeps its exact public field name for project-owned adapters.
          authority: { workspaceOnly: true, deployment: false, productionDatabase: false, networkApproved: options.allowNetwork === true },
          attempt,
          recovery: recoveryInput(verification)
        }
      : {
          schemaVersion: 2,
          task,
          implementation: {
            adapterKind: loadedConfig.config.adapter.kind,
            provider: loadedConfig.config.adapter.kind === 'provider' ? loadedConfig.config.adapter.provider : null,
            profile,
            allowedPrefixes: loadedConfig.config.writePolicy.allowedPrefixes,
            maxChangedFiles: loadedConfig.config.writePolicy.maxChangedFiles,
            maxDiffBytes: loadedConfig.config.writePolicy.maxDiffBytes
          },
          codeContext,
          projectConventions,
          authority: {
            workspaceOnly: true,
            deployment: false,
            productionDatabase: false,
            networkRiskAcknowledged: options.allowNetwork === true,
            egressIsolation: 'not-enforced'
          },
          attempt,
          recovery: recoveryInput(verification)
        }
    const requestBefore = await atomicJson(requestPath, request, loadedConfig.config.adapter.kind === 'provider')
    const beforeCapture = await captureImplementationBinding(workspace.path, verificationConfig)
    const requestRelative = './' + relative(workspace.path, requestPath).replaceAll('\\', '/')
    const processEnvironment = { ...buildSafeEnvironment(), BTH_IMPLEMENTATION_REQUEST: requestPath, BTH_IMPLEMENTATION_ATTEMPT: String(attempt) }
    const adapterRun = loadedConfig.config.adapter.kind === 'provider'
      ? await (options.providerRunner ?? runImplementationProvider)(loadedConfig.config.adapter, {
          requestPath: requestRelative,
          cwd: workspace.path,
          profile,
          env: processEnvironment
        }, { version: providerProbe?.version })
      : {
          process: await runProcess({
            program: adapter.path,
            args: [...loadedConfig.config.adapter.command.slice(1), '--request', requestRelative],
            cwd: workspace.path,
            timeoutMs: loadedConfig.config.adapter.timeoutMs,
            env: processEnvironment
          }),
          metadata: { kind: 'command', id: loadedConfig.config.adapter.id }
        }
    const processResult = adapterRun.process
    const requestAfter = await requestIntegrity(requestPath, requestBefore)
    const requestChanged = requestAfter.unchanged !== true
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
    const adapterPassed = processPassed(processResult) && !requestChanged && !afterCapture.error && !historyChanged && !sharedRefsChanged && indexFlagChanges.length === 0 && !declaredInputsChanged && changed && protectedChanges.length === 0 && writePolicy.passed
    const policyFailure = requestChanged || Boolean(afterCapture.error) || historyChanged || sharedRefsChanged || indexFlagChanges.length > 0 || declaredInputsChanged || protectedChanges.length > 0 || (writePolicy && !writePolicy.passed)
    let candidateFiles = []
    let feedback = null
    let attemptVerification
    let gateIntegrityFailure = false
    if (!processPassed(processResult)) {
      attemptVerification = adapterFailureVerification(processResult, after?.fingerprint ?? null, adapterRun.metadata.failure)
    } else if (policyFailure) {
      attemptVerification = {
          confirmed: false,
          sourceFingerprint: after?.fingerprint ?? null,
          runPath: null,
          failure: {
            code: requestChanged
              ? 'implementation_request_changed'
              : afterCapture.error
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
            message: requestChanged
              ? 'Implementation adapter changed or removed its sealed request document.'
              : afterCapture.error
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
    } else if (!changed) {
      attemptVerification = {
        confirmed: false,
        sourceFingerprint: after?.fingerprint ?? null,
        runPath: null,
        failure: {
          code: 'implementation_no_source_change',
          message: 'The implementation provider completed without a source change. BTH stopped without running Gates or spending a blind recovery attempt.'
        },
        tests: null,
        gates: []
      }
    } else if (adapterPassed) {
      candidateFiles = await snapshotImplementedFiles(workspace.path, changedPaths)
      const selectedFeedbackGates = selectVerificationGates(verificationConfig.gates, { mode: 'feedback', changedPaths })
      if (selectedFeedbackGates.length > 0) {
        feedback = compactVerification(await checkProject(workspace.path, {
          allowNetwork: options.allowNetwork === true,
          verificationScope: { mode: 'feedback', changedPaths }
        }))
        const feedbackIntegrity = await candidateIntegrity(workspace.path, sourceBinding, baseRefsSha256, changedPaths, candidateFiles)
        if (!feedbackIntegrity.valid) {
          gateIntegrityFailure = true
          attemptVerification = candidateIntegrityFailure(feedback, feedbackIntegrity)
        } else if (!feedback.confirmed) {
          attemptVerification = {
            ...feedback,
            failure: {
              code: 'selected_feedback_failed',
              message: 'A changed-path feedback Gate failed before the complete required verification suite.'
            }
          }
        }
      }
      if (!attemptVerification) {
        const checked = compactVerification(await checkProject(workspace.path, { allowNetwork: options.allowNetwork === true }))
        const integrity = await candidateIntegrity(workspace.path, sourceBinding, baseRefsSha256, changedPaths, candidateFiles)
        if (!integrity.valid) {
          gateIntegrityFailure = true
          attemptVerification = candidateIntegrityFailure(checked, integrity)
        } else {
          attemptVerification = checked
        }
      }
    } else {
      attemptVerification = null
    }
    if (attemptVerification) verification = attemptVerification
    attempts.push({
      attempt,
      invocation: adapterRun.metadata,
      request: {
        path: requestRelative,
        bytes: requestBefore.bytes,
        sha256: requestBefore.sha256,
        unchanged: requestAfter.unchanged,
        observedSha256: requestAfter.sha256
      },
      adapter: compactProcess(processResult),
      feedback,
      changed,
      writePolicy,
      sourceFingerprintBefore: beforeCapture.binding?.fingerprint ?? null,
      sourceFingerprintAfter: after?.fingerprint ?? null,
      outcome: !processPassed(processResult)
        ? 'adapter-failed'
        : policyFailure
          ? requestChanged
            ? 'control-plane-change'
            : afterCapture.error
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
    if (attempts.at(-1)?.outcome === 'no-source-change' || gateIntegrityFailure || providerFailureIsNonRetryable(adapterRun)) break
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
    adapterKind: loadedConfig.config.adapter.kind,
    provider: providerProbe ? {
      id: loadedConfig.config.adapter.provider,
      version: providerProbe.version,
      profile
    } : null,
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
      ? 'Review the isolated diff, then run bth implement apply ' + taskId + ' <project> --by <actor> --allow-write and bth verify on the integrated source.'
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
