import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, relative, resolve } from 'node:path'
import {
  assertNoSymlinkSegments,
  resolveReadableRoot,
  resolveSafeProjectPath,
  statPath
} from '../fs-safety.mjs'
import { assertTaskId, createTaskRecord, normalizeTaskText, transitionTaskRecord } from './task-state.mjs'
import { canonicalJson } from './canonical-json.mjs'
import { processIsAlive, withLockRecoveryGuard } from './lock-recovery.mjs'

async function harnessPaths(inputPath, taskId) {
  const root = await resolveReadableRoot(inputPath)
  const harnessRoot = await resolveSafeProjectPath(root, '.backend-harness')
  const harnessStat = await statPath(harnessRoot)
  if (!harnessStat?.isDirectory() || harnessStat.isSymbolicLink()) {
    throw new Error('Shared contract is missing. Run `bth init <path>` first.')
  }

  const id = assertTaskId(taskId)
  const taskDir = await resolveSafeProjectPath(root, '.backend-harness/tasks/' + id)
  const lockPath = await resolveSafeProjectPath(root, '.backend-harness/local/locks/task-' + id + '.lock')
  return { root, harnessRoot, taskDir, lockPath, id }
}

function createdEvent(record) {
  return sealEvent({
    schemaVersion: 1,
    seq: 0,
    type: 'task_created',
    at: record.createdAt,
    record
  }, null)
}

function sealEvent(event, previousEventSha256) {
  const unsigned = { ...event, previousEventSha256 }
  return {
    ...unsigned,
    eventSha256: createHash('sha256').update(canonicalJson(unsigned)).digest('hex')
  }
}

function taskMarkdown(record) {
  return [
    '# ' + record.title,
    '',
    '- Task ID: `' + record.id + '`',
    '- Current state: `' + record.state + '`',
    '- Created: ' + record.createdAt,
    '- Planned source: ' + (record.planSourceFingerprint ? '`' + record.planSourceFingerprint + '`' : '_not bound_'),
    '- Canonical plan artifact: ' + (record.planArtifactSha256 ? '`' + record.planArtifactSha256 + '`' : '_manual plan_'),
    '- Approved: ' + (record.approvalReceipt ? record.approvalReceipt.at + ' by ' + record.approvalReceipt.actor : '_not approved_'),
    '',
    '## Context',
    '',
    record.context ?? '_Context has not been supplied yet._',
    '',
    '## Plan',
    '',
    record.plan ?? '_A change plan has not been proposed yet._',
    '',
    'The authoritative lifecycle is stored in `events.jsonl`; `task.json` is a replayable snapshot.',
    ''
  ].join('\n')
}

async function atomicJsonWrite(target, value) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

async function atomicTextWrite(target, value) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, value, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function serializeEvent(event) {
  const serialized = JSON.stringify(event) + '\n'
  if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) {
    throw new Error('Task event exceeds the 1 MiB safety limit.')
  }
  return serialized
}

async function appendEvent(eventPath, event) {
  const serialized = serializeEvent(event)
  const handle = await open(eventPath, 'a')
  try {
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function recoverStaleLock(lockPath, staleMs) {
  return withLockRecoveryGuard(lockPath, { malformedStaleMs: Math.min(staleMs, 5000) }, async () => {
    const stat = await statPath(lockPath)
    if (!stat) {
      return true
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Task lock is not a regular file: ' + lockPath)
    }

    let metadata = null
    try {
      metadata = JSON.parse(await readFile(lockPath, 'utf8'))
    } catch {
      // An interrupted write is recoverable only after the age threshold.
    }
    const acquiredAt = Date.parse(metadata?.acquiredAt ?? '')
    const ageMs = Date.now() - (Number.isFinite(acquiredAt) ? acquiredAt : stat.mtimeMs)
    const deadOwner = Number.isInteger(metadata?.pid) && metadata.pid > 0 && !processIsAlive(metadata.pid)
    const malformedAndStale = !Number.isInteger(metadata?.pid) && ageMs >= Math.min(staleMs, 5000)
    if (deadOwner || malformedAndStale) {
      let current = null
      try {
        current = JSON.parse(await readFile(lockPath, 'utf8'))
      } catch {
        // The malformed identity is represented by a null nonce.
      }
      if ((metadata?.nonce ?? null) !== (current?.nonce ?? null)) {
        return false
      }
      await unlink(lockPath)
      return true
    }
    return false
  })
}

async function acquireLock(lockPath, options = {}) {
  await assertNoSymlinkSegments(dirname(dirname(lockPath)), lockPath)
  await mkdir(dirname(lockPath), { recursive: true })
  const timeoutMs = options.timeoutMs ?? 3000
  const staleMs = options.staleMs ?? 30_000
  const started = Date.now()
  const nonce = randomUUID()

  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, acquiredAt: new Date().toISOString() }) + '\n')
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        throw error
      }
      return async () => {
        await handle.close()
        let current = null
        try {
          current = JSON.parse(await readFile(lockPath, 'utf8'))
        } catch {
          // A missing or changed lock is an ownership failure.
        }
        if (current?.nonce !== nonce) {
          throw new Error('Task lock ownership changed before release.')
        }
        await unlink(lockPath).catch((error) => {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      if (await recoverStaleLock(lockPath, staleMs)) {
        continue
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error('Timed out waiting for the task lock: ' + lockPath)
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
    }
  }
}

function parseEvents(text, taskId) {
  const lines = text.split('\n').filter((line) => line.trim())
  if (lines.length === 0) {
    throw new Error('Task event log is empty: ' + taskId)
  }
  if (lines.length > 10_000) {
    throw new Error('Task event log exceeds the 10000-event safety limit: ' + taskId)
  }

  let previousHash = null
  return lines.map((line, index) => {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error('Task event log contains invalid JSON at line ' + (index + 1) + ': ' + taskId)
    }
    const { eventSha256, ...unsigned } = event
    const expectedHash = createHash('sha256').update(canonicalJson(unsigned)).digest('hex')
    const legacyHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
    if (![expectedHash, legacyHash].includes(eventSha256) || event.previousEventSha256 !== previousHash) {
      throw new Error('Task event log hash chain is inconsistent at line ' + (index + 1) + ': ' + taskId)
    }
    if (event.seq !== index || event.record?.id !== taskId || event.record?.revision !== index) {
      throw new Error('Task event log sequence is inconsistent at line ' + (index + 1) + ': ' + taskId)
    }
    previousHash = eventSha256
    return event
  })
}

async function loadConfirmedEvidence(taskDir, taskId, evidenceId) {
  if (typeof evidenceId !== 'string' || !/^verify-[A-Za-z0-9_-]+$/.test(evidenceId)) {
    throw new Error('A safe evidence id is required for verified completion.')
  }
  const path = resolve(taskDir, 'evidence', evidenceId + '.json')
  await assertNoSymlinkSegments(taskDir, path)
  let record
  try {
    record = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('Confirmed evidence record does not exist: ' + evidenceId)
    }
    throw error
  }
  const { recordSha256, ...unsigned } = record
  const expectedHash = record.schemaVersion >= 3
    ? createHash('sha256').update(canonicalJson(unsigned)).digest('hex')
    : createHash('sha256').update(JSON.stringify(unsigned)).digest('hex')
  if (
    recordSha256 !== expectedHash ||
    record.id !== evidenceId ||
    record.taskId !== taskId ||
    record.confirmed !== true ||
    record.outcome !== 'confirmed'
  ) {
    throw new Error('Evidence is missing, altered, or not confirmed: ' + evidenceId)
  }
  return record
}

async function loadFromTaskDirectory(taskDir, taskId) {
  await assertNoSymlinkSegments(dirname(taskDir), taskDir)
  const eventPath = resolve(taskDir, 'events.jsonl')
  await assertNoSymlinkSegments(taskDir, eventPath)
  const metadata = await statPath(eventPath)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
    throw new Error('Task event log is missing, unsafe, or exceeds 16 MiB: ' + taskId)
  }
  const events = parseEvents(await readFile(eventPath, 'utf8'), taskId)
  return { record: events.at(-1).record, events }
}

export async function createTask(inputPath, input, options = {}) {
  const paths = await harnessPaths(inputPath, input.id)
  const existing = await statPath(paths.taskDir)
  if (existing) {
    throw new Error('Task already exists: ' + paths.id)
  }

  const record = createTaskRecord({ ...input, id: paths.id }, { at: options.at })
  const tasksRoot = dirname(paths.taskDir)
  await mkdir(tasksRoot, { recursive: true })
  await assertNoSymlinkSegments(paths.harnessRoot, tasksRoot)

  const stagingRoot = await resolveSafeProjectPath(paths.root, '.backend-harness/local/staging')
  await mkdir(stagingRoot, { recursive: true })
  const staging = resolve(stagingRoot, 'task-' + randomUUID())
  await mkdir(staging, { recursive: false })

  try {
    const event = createdEvent(record)
    await writeFile(resolve(staging, 'events.jsonl'), serializeEvent(event), { encoding: 'utf8', flag: 'wx' })
    await writeFile(resolve(staging, 'task.json'), JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    await writeFile(resolve(staging, 'task.md'), taskMarkdown(record), { encoding: 'utf8', flag: 'wx' })
    await rename(staging, paths.taskDir)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return { root: paths.root, record, taskPath: relative(paths.root, paths.taskDir) }
}

export async function loadTask(inputPath, taskId) {
  const paths = await harnessPaths(inputPath, taskId)
  const taskStat = await statPath(paths.taskDir)
  if (!taskStat?.isDirectory() || taskStat.isSymbolicLink()) {
    throw new Error('Task does not exist: ' + paths.id)
  }
  const loaded = await loadFromTaskDirectory(paths.taskDir, paths.id)
  return { root: paths.root, taskPath: relative(paths.root, paths.taskDir), ...loaded }
}

export async function advanceTask(inputPath, taskId, to, input = {}, options = {}) {
  const paths = await harnessPaths(inputPath, taskId)
  const release = await acquireLock(paths.lockPath, options)
  try {
    const loaded = await loadFromTaskDirectory(paths.taskDir, paths.id)
    let transitionInput = input
    if (loaded.record.state === 'VERIFYING' && to === 'VERIFIED' && input.evidence?.id) {
      const evidence = await loadConfirmedEvidence(paths.taskDir, paths.id, input.evidence.id)
      transitionInput = { ...input, evidence: { id: evidence.id, confirmed: true } }
    }
    if (loaded.record.state === 'VERIFIED' && to === 'DONE' && loaded.record.lastEvidenceId) {
      const evidence = await loadConfirmedEvidence(paths.taskDir, paths.id, loaded.record.lastEvidenceId)
      if (evidence.sourceBinding?.fingerprint) {
        if (!options.currentSourceFingerprint) {
          throw new Error('Current Git source binding is required before completing a verified task.')
        }
        if (options.currentSourceFingerprint !== evidence.sourceBinding.fingerprint) {
          throw new Error('Source changed after verification. Run `bth verify` again before completing the task.')
        }
      }
    }
    const transition = transitionTaskRecord(loaded.record, to, transitionInput)
    if (!transition.applied) {
      return { root: paths.root, ...transition }
    }

    const event = sealEvent({
      schemaVersion: 1,
      seq: transition.record.revision,
      type: 'state_transition',
      at: transition.record.updatedAt,
      audit: transition.audit,
      record: transition.record
    }, loaded.events.at(-1).eventSha256)
    const eventPath = resolve(paths.taskDir, 'events.jsonl')
    await assertNoSymlinkSegments(paths.taskDir, eventPath)
    await appendEvent(eventPath, event)
    await atomicJsonWrite(resolve(paths.taskDir, 'task.json'), transition.record)
    await atomicTextWrite(resolve(paths.taskDir, 'task.md'), taskMarkdown(transition.record))
    return { root: paths.root, ...transition, event }
  } finally {
    await release()
  }
}

async function updateTaskField(inputPath, taskId, field, value, input = {}, options = {}) {
  const normalized = normalizeTaskText(value, field, 256 * 1024)
  if (!normalized) {
    throw new Error('Task ' + field + ' cannot be empty.')
  }
  const actor = normalizeTaskText(input.actor, 'actor', 128)
  if (!actor) {
    throw new Error('Task ' + field + ' update requires an actor.')
  }
  const reason = normalizeTaskText(input.reason, 'reason', 2048)
  const planSourceFingerprint = field === 'plan' ? (input.sourceFingerprint ?? null) : null
  if (planSourceFingerprint !== null && !/^[a-f0-9]{64}$/.test(planSourceFingerprint)) {
    throw new Error('Task plan source fingerprint must be a lowercase SHA-256 value.')
  }
  const planArtifactSha256 = field === 'plan' ? (input.artifactSha256 ?? null) : null
  if (planArtifactSha256 !== null && !/^[a-f0-9]{64}$/.test(planArtifactSha256)) {
    throw new Error('Task plan artifact digest must be a lowercase SHA-256 value.')
  }

  const paths = await harnessPaths(inputPath, taskId)
  const release = await acquireLock(paths.lockPath, options)
  try {
    const loaded = await loadFromTaskDirectory(paths.taskDir, paths.id)
    if (['VERIFYING', 'VERIFIED', 'DONE'].includes(loaded.record.state)) {
      throw new Error('Task ' + field + ' cannot change while the task is ' + loaded.record.state + '.')
    }
    const at = input.at ?? new Date().toISOString()
    const approvalInvalidated = ['PLAN_PROPOSED', 'PLAN_APPROVED', 'IMPLEMENTING', 'VERIFY_FAILED', 'POLICY_BLOCKED', 'PERMISSION_DENIED'].includes(loaded.record.state)
    const nextState = approvalInvalidated
      ? (field === 'context' || loaded.record.context ? 'CONTEXT_READY' : 'CONTEXT_MISSING')
      : loaded.record.state
    const record = {
      ...loaded.record,
      [field]: normalized,
      state: nextState,
      revision: loaded.record.revision + 1,
      updatedAt: at,
      lastEvidenceId: approvalInvalidated ? null : loaded.record.lastEvidenceId,
      planSourceFingerprint: field === 'plan'
        ? planSourceFingerprint
        : null,
      planArtifactSha256: field === 'plan'
        ? planArtifactSha256
        : null,
      approvalReceipt: approvalInvalidated ? null : (loaded.record.approvalReceipt ?? null)
    }
    const event = sealEvent({
      schemaVersion: 1,
      seq: record.revision,
      type: field + '_updated',
      at,
      audit: {
        type: field + '_updated',
        actor,
        reason,
        approvalInvalidated,
        from: loaded.record.state,
        to: nextState,
        at
      },
      record
    }, loaded.events.at(-1).eventSha256)
    const eventPath = resolve(paths.taskDir, 'events.jsonl')
    await assertNoSymlinkSegments(paths.taskDir, eventPath)
    await appendEvent(eventPath, event)
    await atomicJsonWrite(resolve(paths.taskDir, 'task.json'), record)
    await atomicTextWrite(resolve(paths.taskDir, 'task.md'), taskMarkdown(record))
    return { root: paths.root, record, event }
  } finally {
    await release()
  }
}

export function updateTaskContext(inputPath, taskId, context, input = {}, options = {}) {
  return updateTaskField(inputPath, taskId, 'context', context, input, options)
}

export function updateTaskPlan(inputPath, taskId, plan, input = {}, options = {}) {
  return updateTaskField(inputPath, taskId, 'plan', plan, input, options)
}

export async function taskDirectory(inputPath, taskId) {
  const paths = await harnessPaths(inputPath, taskId)
  const taskStat = await statPath(paths.taskDir)
  if (!taskStat?.isDirectory() || taskStat.isSymbolicLink()) {
    throw new Error('Task does not exist: ' + paths.id)
  }
  return { root: paths.root, taskDir: paths.taskDir, id: paths.id }
}
