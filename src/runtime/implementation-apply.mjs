import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { canonicalJson } from '../core/canonical-json.mjs'
import { bthError } from '../core/errors.mjs'
import {
  implementationCandidateStatus,
  implementationIntegrationStatus,
  loadImplementationRecord,
  snapshotImplementedFiles
} from '../core/implementation-record-store.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'
import { recordImplementationLifecycle } from '../core/task-store.mjs'
import { assertTaskId } from '../core/task-state.mjs'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { captureConfiguredSourceBinding } from './backend-harness.mjs'
import { resolveRecordedWorkspace } from './implementation-orchestrator.mjs'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

async function atomicCopy(root, source, target, executable) {
  await mkdir(dirname(target), { recursive: true })
  await assertNoSymlinkSegments(root, target)
  const temporary = resolve(dirname(target), '.bth-apply-' + randomUUID() + '.tmp')
  try {
    await copyFile(source, temporary)
    await chmod(temporary, executable ? 0o755 : 0o644)
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function stageCandidate(root, workspace, record, stagingRoot) {
  const candidateRoot = resolve(stagingRoot, 'candidate')
  const backupRoot = resolve(stagingRoot, 'backup')
  const manifest = []
  for (const entry of record.implementedFiles) {
    const target = await resolveSafeProjectPath(root, entry.path)
    const original = await statPath(target)
    if (original && (!original.isFile() || original.isSymbolicLink())) {
      throw bthError('apply_target_unsafe', 'Integration target is not a regular file: ' + entry.path, { path: entry.path })
    }
    const item = {
      path: entry.path,
      candidateKind: entry.kind,
      candidateExecutable: entry.executable,
      originalKind: original ? 'file' : 'missing',
      originalExecutable: original ? (original.mode & 0o111) !== 0 : null
    }
    if (original) {
      const backup = resolve(backupRoot, entry.path)
      await mkdir(dirname(backup), { recursive: true })
      await copyFile(target, backup)
      await chmod(backup, item.originalExecutable ? 0o755 : 0o644)
    }
    if (entry.kind === 'file') {
      const candidate = await resolveSafeProjectPath(workspace, entry.path)
      const staged = resolve(candidateRoot, entry.path)
      await mkdir(dirname(staged), { recursive: true })
      await copyFile(candidate, staged)
      await chmod(staged, entry.executable ? 0o755 : 0o644)
    } else if (entry.kind !== 'missing') {
      throw bthError('apply_candidate_invalid', 'Candidate evidence contains an unsupported entry kind.', { path: entry.path })
    }
    manifest.push(item)
  }
  const stagedFiles = await snapshotImplementedFiles(candidateRoot, record.implementedFiles.map((entry) => entry.path))
  if (canonicalJson(stagedFiles) !== canonicalJson(record.implementedFiles)) {
    throw bthError('apply_candidate_changed', 'Candidate changed while it was being staged for integration.')
  }
  return { candidateRoot, backupRoot, manifest }
}

async function restoreApplied(root, staged, appliedPaths) {
  const byPath = new Map(staged.manifest.map((entry) => [entry.path, entry]))
  const failures = []
  for (const path of [...appliedPaths].reverse()) {
    const entry = byPath.get(path)
    const target = await resolveSafeProjectPath(root, path)
    try {
      if (entry.originalKind === 'file') {
        await atomicCopy(root, resolve(staged.backupRoot, path), target, entry.originalExecutable)
      } else {
        await unlink(target).catch((error) => {
          if (error?.code !== 'ENOENT') throw error
        })
      }
    } catch (error) {
      failures.push({ path, code: error?.code ?? 'rollback_failed' })
    }
  }
  return failures
}

async function applyStaged(root, staged, options = {}) {
  const appliedPaths = []
  try {
    for (const entry of staged.manifest) {
      if (typeof options.beforeApplyEntry === 'function') await options.beforeApplyEntry(entry, appliedPaths.length)
      const target = await resolveSafeProjectPath(root, entry.path)
      if (entry.candidateKind === 'file') {
        await atomicCopy(root, resolve(staged.candidateRoot, entry.path), target, entry.candidateExecutable)
      } else {
        await unlink(target)
      }
      appliedPaths.push(entry.path)
    }
    return appliedPaths
  } catch (error) {
    const rollbackFailures = await restoreApplied(root, staged, appliedPaths)
    throw bthError(
      rollbackFailures.length ? 'apply_rollback_incomplete' : 'apply_failed_rolled_back',
      rollbackFailures.length
        ? 'Candidate application failed and rollback was incomplete.'
        : 'Candidate application failed; every completed file mutation was rolled back.',
      { appliedPaths, rollbackFailures },
      { cause: error }
    )
  }
}

async function applyUnlocked(root, taskId, options) {
  const id = assertTaskId(taskId)
  const actor = typeof options.actor === 'string' ? options.actor.trim() : ''
  if (!actor) throw bthError('apply_actor_required', 'Implementation apply requires an actor.')
  if (options.allowWrite !== true) throw bthError('apply_write_approval_required', 'Implementation apply requires explicit --allow-write approval.')

  const loaded = await loadImplementationRecord(root, id)
  const record = loaded.record
  if (!record || record.status !== 'passed' || record.schemaVersion !== 2) {
    throw bthError('apply_record_not_passed', 'Implementation apply requires a current passed sealed implementation record.')
  }
  if (!record.workspace) throw bthError('apply_workspace_missing', 'Implementation workspace is missing or was already cleaned.')

  const sourceBefore = await captureConfiguredSourceBinding(root)
  if (!sourceBefore.clean || sourceBefore.fingerprint !== record.baseSourceFingerprint || sourceBefore.headCommit !== record.baseHeadCommit) {
    throw bthError(
      'apply_source_changed',
      'Bound source changed after isolated implementation; re-plan or integrate the candidate manually.',
      { clean: sourceBefore.clean, headMatches: sourceBefore.headCommit === record.baseHeadCommit }
    )
  }

  const workspace = await resolveRecordedWorkspace(root, record.workspace)
  const candidate = await implementationCandidateStatus(workspace, record)
  if (!candidate.valid) {
    throw bthError('apply_candidate_changed', candidate.reason, { mismatches: candidate.mismatches })
  }

  const stagingRoot = await resolveSafeProjectPath(root, '.backend-harness/local/apply/' + id + '-' + randomUUID())
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  let staged
  try {
    staged = await stageCandidate(root, workspace, record, stagingRoot)
    const sourceAfterStaging = await captureConfiguredSourceBinding(root)
    if (sourceAfterStaging.fingerprint !== sourceBefore.fingerprint) {
      throw bthError('apply_source_changed', 'Bound source changed while the candidate was being staged.')
    }

    const appliedPaths = await applyStaged(root, staged, options)
    const currentSourceBinding = await captureConfiguredSourceBinding(root)
    const integration = await implementationIntegrationStatus(root, record, { currentSourceBinding })
    if (!integration.integrated) {
      const rollbackFailures = await restoreApplied(root, staged, appliedPaths)
      throw bthError(
        rollbackFailures.length ? 'apply_verification_rollback_incomplete' : 'apply_verification_failed_rolled_back',
        rollbackFailures.length
          ? 'Applied source did not match sealed evidence and rollback was incomplete.'
          : 'Applied source did not match sealed evidence; all candidate changes were rolled back.',
        { mismatches: integration.mismatches, rollbackFailures }
      )
    }

    const appliedAt = new Date().toISOString()
    const unsigned = {
      schemaVersion: 1,
      type: 'implementation_apply',
      taskId: id,
      actor,
      appliedAt,
      implementationRecordSha256: record.recordSha256,
      baseSourceFingerprint: record.baseSourceFingerprint,
      integratedSourceFingerprint: currentSourceBinding.fingerprint,
      paths: record.implementedFiles.map((entry) => entry.path),
      candidateEvidenceSha256: sha256(canonicalJson(record.implementedFiles))
    }
    const receipt = { ...unsigned, receiptSha256: sha256(canonicalJson(unsigned)) }
    const receiptPath = await resolveSafeProjectPath(
      root,
      '.backend-harness/local/implementation/apply/' + id + '-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json'
    )
    await mkdir(dirname(receiptPath), { recursive: true, mode: 0o700 })
    await atomicJson(receiptPath, receipt)

    let lifecycleRecorded = true
    try {
      await recordImplementationLifecycle(root, id, 'apply', {
        actor,
        artifact: relative(root, receiptPath).replaceAll('\\', '/'),
        recordSha256: receipt.receiptSha256,
        at: appliedAt
      })
    } catch {
      lifecycleRecorded = false
    }
    return {
      root,
      taskId: id,
      actor,
      receipt: relative(root, receiptPath).replaceAll('\\', '/'),
      receiptSha256: receipt.receiptSha256,
      lifecycleRecorded,
      integration,
      nextAction: 'Review the applied diff, then run bth verify ' + id + ' before committing through the normal team Git workflow.'
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

export function applyImplementation(inputPath, taskId, options = {}) {
  return withProjectVerificationLock(inputPath, options.projectLock, async () => {
    const root = await resolveReadableRoot(inputPath)
    return applyUnlocked(root, taskId, options)
  })
}
