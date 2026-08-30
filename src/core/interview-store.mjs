import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { assertNoSymlinkSegments, statPath } from '../fs-safety.mjs'
import { canonicalJson } from './canonical-json.mjs'
import {
  answerInterviewRecord,
  createInterviewRecord,
  finalizeInterviewRecord,
  interviewContradictions,
  interviewProgress,
  rebindInterviewRecord,
  resolveInterviewContradictionRecord,
  reviseInterviewRecord
} from './interview-state.mjs'
import { taskDirectory } from './task-store.mjs'

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')
}

function sealEvent(event, previousEventSha256) {
  const unsigned = { ...event, previousEventSha256 }
  return { ...unsigned, eventSha256: sha256(unsigned) }
}

function serializedEvent(event) {
  const serialized = JSON.stringify(event) + '\n'
  if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) {
    throw new Error('Interview event exceeds the 1 MiB safety limit.')
  }
  return serialized
}

async function atomicWrite(path, content) {
  const temporary = resolve(dirname(path), '.bth-interview-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function atomicJsonWrite(path, value) {
  return atomicWrite(path, JSON.stringify(value, null, 2) + '\n')
}

async function appendEvent(path, event) {
  const handle = await open(path, 'a')
  try {
    await handle.writeFile(serializedEvent(event), 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function parseEvents(text, taskId) {
  const lines = text.split('\n').filter((line) => line.trim())
  if (lines.length === 0 || lines.length > 1_000) {
    throw new Error('Interview event log is empty or exceeds the 1000-event safety limit: ' + taskId)
  }
  let previousHash = null
  return lines.map((line, index) => {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      throw new Error('Interview event log contains invalid JSON at line ' + (index + 1) + ': ' + taskId)
    }
    const { eventSha256, ...unsigned } = event
    if (
      eventSha256 !== sha256(unsigned) ||
      event.previousEventSha256 !== previousHash ||
      event.seq !== index ||
      event.record?.taskId !== taskId ||
      event.record?.revision !== index
    ) {
      throw new Error('Interview event log hash chain is inconsistent at line ' + (index + 1) + ': ' + taskId)
    }
    previousHash = eventSha256
    return event
  })
}

async function interviewPaths(inputPath, taskId) {
  const task = await taskDirectory(inputPath, taskId)
  const interviewDir = resolve(task.taskDir, 'interview')
  await assertNoSymlinkSegments(task.taskDir, interviewDir)
  return {
    ...task,
    interviewDir,
    eventPath: resolve(interviewDir, 'events.jsonl'),
    snapshotPath: resolve(interviewDir, 'interview.json'),
    contextPath: resolve(interviewDir, 'context-snapshot.json'),
    contextSnapshotsDir: resolve(interviewDir, 'context-snapshots')
  }
}

function createdEvent(record) {
  return sealEvent({
    schemaVersion: 1,
    seq: 0,
    type: 'interview_started',
    at: record.createdAt,
    audit: { actor: record.createdBy },
    record
  }, null)
}

export async function createInterview(inputPath, input, options = {}) {
  const paths = await interviewPaths(inputPath, input.taskId)
  if (await statPath(paths.interviewDir)) {
    throw new Error('Interview already exists for task: ' + input.taskId)
  }
  const record = createInterviewRecord(input, options)
  const staging = resolve(paths.taskDir, '.interview-' + randomUUID())
  await mkdir(staging, { recursive: false })
  try {
    await writeFile(resolve(staging, 'events.jsonl'), serializedEvent(createdEvent(record)), { encoding: 'utf8', flag: 'wx' })
    await writeFile(resolve(staging, 'interview.json'), JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    await writeFile(resolve(staging, 'context-snapshot.json'), JSON.stringify(input.contextSnapshot, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    await mkdir(resolve(staging, 'context-snapshots'), { recursive: false })
    await writeFile(
      resolve(staging, 'context-snapshots', record.contextSnapshotSha256 + '.json'),
      JSON.stringify(input.contextSnapshot, null, 2) + '\n',
      { encoding: 'utf8', flag: 'wx' }
    )
    await rename(staging, paths.interviewDir)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return {
    root: paths.root,
    path: relative(paths.root, paths.interviewDir),
    record,
    contextSnapshot: input.contextSnapshot,
    progress: interviewProgress(record, input.contextSnapshot)
  }
}

export async function loadInterview(inputPath, taskId) {
  const paths = await interviewPaths(inputPath, taskId)
  const directoryStat = await statPath(paths.interviewDir)
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Interview does not exist for task: ' + taskId)
  }
  for (const path of [paths.eventPath]) {
    await assertNoSymlinkSegments(paths.interviewDir, path)
    const metadata = await statPath(path)
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
      throw new Error('Interview file is missing, unsafe, or too large: ' + relative(paths.root, path))
    }
  }
  const events = parseEvents(await readFile(paths.eventPath, 'utf8'), taskId)
  const record = events.at(-1).record
  if (!/^[a-f0-9]{64}$/.test(record.contextSnapshotSha256)) {
    throw new Error('Interview project-context snapshot digest is invalid: ' + taskId)
  }
  const immutableContextPath = resolve(paths.contextSnapshotsDir, record.contextSnapshotSha256 + '.json')
  const immutableContextStat = await statPath(immutableContextPath)
  const selectedContextPath = immutableContextStat ? immutableContextPath : paths.contextPath
  await assertNoSymlinkSegments(paths.interviewDir, selectedContextPath)
  const contextMetadata = await statPath(selectedContextPath)
  if (!contextMetadata?.isFile() || contextMetadata.isSymbolicLink() || contextMetadata.size > 16 * 1024 * 1024) {
    throw new Error('Interview project-context snapshot is missing, unsafe, or too large: ' + taskId)
  }
  const contextSnapshot = JSON.parse(await readFile(selectedContextPath, 'utf8'))
  if (sha256(contextSnapshot) !== record.contextSnapshotSha256) {
    throw new Error('Interview project-context snapshot has been altered: ' + taskId)
  }
  const legacyContextStat = await statPath(paths.contextPath)
  if (legacyContextStat) {
    await assertNoSymlinkSegments(paths.interviewDir, paths.contextPath)
    if (!legacyContextStat.isFile() || legacyContextStat.isSymbolicLink() || legacyContextStat.size > 16 * 1024 * 1024) {
      throw new Error('Interview legacy project-context snapshot is unsafe: ' + taskId)
    }
    const legacyContext = JSON.parse(await readFile(paths.contextPath, 'utf8'))
    const historicalDigests = new Set(events.map((event) => event.record.contextSnapshotSha256))
    if (!historicalDigests.has(sha256(legacyContext))) {
      throw new Error('Interview project-context snapshot has been altered: ' + taskId)
    }
  }
  const artifacts = {}
  if (record.status === 'FINALIZED') {
    for (const name of ['requirement', 'context', 'impact', 'plan']) {
      const path = resolve(paths.interviewDir, name + '.json')
      await assertNoSymlinkSegments(paths.interviewDir, path)
      const metadata = await statPath(path)
      if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
        throw new Error('Finalized interview artifact is missing, unsafe, or too large: ' + name)
      }
      const value = JSON.parse(await readFile(path, 'utf8'))
      if (sha256(value) !== record.artifactDigests?.[name]) {
        throw new Error('Finalized interview artifact has been altered: ' + name)
      }
      artifacts[name] = value
    }
  }
  return {
    root: paths.root,
    path: relative(paths.root, paths.interviewDir),
    record,
    events,
    contextSnapshot,
    artifacts,
    progress: interviewProgress(record, contextSnapshot)
  }
}

async function persistTransition(paths, previousEvent, type, record, audit) {
  const event = sealEvent({
    schemaVersion: 1,
    seq: record.revision,
    type,
    at: record.updatedAt,
    audit,
    record
  }, previousEvent.eventSha256)
  await appendEvent(paths.eventPath, event)
  await atomicJsonWrite(paths.snapshotPath, record)
  return event
}

export async function recordInterviewAnswer(inputPath, taskId, input, options = {}) {
  const loaded = await loadInterview(inputPath, taskId)
  const paths = await interviewPaths(loaded.root, taskId)
  const record = answerInterviewRecord(loaded.record, input, options)
  const event = await persistTransition(paths, loaded.events.at(-1), 'question_answered', record, {
    actor: input.actor,
    questionId: input.questionId,
    answerStatus: input.status ?? 'answered'
  })
  return { ...loaded, record, event, progress: interviewProgress(record, loaded.contextSnapshot) }
}

export async function reviseInterviewAnswer(inputPath, taskId, input, options = {}) {
  const loaded = await loadInterview(inputPath, taskId)
  const paths = await interviewPaths(loaded.root, taskId)
  const record = reviseInterviewRecord(loaded.record, input, options)
  const event = await persistTransition(paths, loaded.events.at(-1), 'question_revised', record, {
    actor: input.actor,
    questionId: input.questionId,
    answerStatus: input.status ?? 'answered'
  })
  return { ...loaded, record, event, progress: interviewProgress(record, loaded.contextSnapshot) }
}

export async function recordInterviewContradictionResolution(inputPath, taskId, input, options = {}) {
  const loaded = await loadInterview(inputPath, taskId)
  const paths = await interviewPaths(loaded.root, taskId)
  const record = resolveInterviewContradictionRecord(loaded.record, input, loaded.contextSnapshot, options)
  const resolution = record.contradictionResolutions.find((entry) => entry.candidateId === input.candidateId)
  const event = await persistTransition(paths, loaded.events.at(-1), 'contradiction_resolved', record, {
    actor: input.actor,
    candidateId: input.candidateId,
    candidateSha256: resolution.candidateSha256,
    contextSnapshotSha256: resolution.contextSnapshotSha256,
    reason: input.reason
  })
  return { ...loaded, record, event, progress: interviewProgress(record, loaded.contextSnapshot) }
}

async function writeImmutableContext(paths, contextSnapshot, digest) {
  await mkdir(paths.contextSnapshotsDir, { recursive: true })
  await assertNoSymlinkSegments(paths.interviewDir, paths.contextSnapshotsDir)
  const target = resolve(paths.contextSnapshotsDir, digest + '.json')
  await assertNoSymlinkSegments(paths.interviewDir, target)
  try {
    await writeFile(target, JSON.stringify(contextSnapshot, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
    const existing = JSON.parse(await readFile(target, 'utf8'))
    if (sha256(existing) !== digest) {
      throw new Error('Existing immutable context snapshot is inconsistent: ' + digest)
    }
  }
  return target
}

export async function rebindInterviewContext(inputPath, taskId, input, options = {}) {
  const loaded = await loadInterview(inputPath, taskId)
  const paths = await interviewPaths(loaded.root, taskId)
  const record = rebindInterviewRecord(loaded.record, input, options)
  await writeImmutableContext(paths, input.contextSnapshot, record.contextSnapshotSha256)
  const event = await persistTransition(paths, loaded.events.at(-1), 'context_rebound', record, {
    actor: input.actor,
    previousSourceFingerprint: loaded.record.sourceFingerprint,
    sourceFingerprint: record.sourceFingerprint,
    contextSnapshotSha256: record.contextSnapshotSha256
  })
  await atomicJsonWrite(paths.contextPath, input.contextSnapshot)
  return {
    ...loaded,
    record,
    event,
    contextSnapshot: input.contextSnapshot,
    progress: interviewProgress(record, input.contextSnapshot)
  }
}

export async function finalizeInterview(inputPath, taskId, input, options = {}) {
  const loaded = await loadInterview(inputPath, taskId)
  const paths = await interviewPaths(loaded.root, taskId)
  const artifactNames = Object.keys(input.artifacts ?? {}).sort()
  if (artifactNames.join(',') !== 'context,impact,plan,requirement') {
    throw new Error('Interview finalization requires requirement, context, impact, and plan artifacts.')
  }
  const artifactDigests = Object.fromEntries(
    Object.entries(input.artifacts).map(([name, value]) => [name, sha256(value)])
  )
  const record = finalizeInterviewRecord(loaded.record, {
    actor: input.actor,
    currentSourceFingerprint: input.currentSourceFingerprint,
    artifactDigests,
    contradictions: interviewContradictions(loaded.record, loaded.contextSnapshot)
  }, options)

  for (const [name, value] of Object.entries(input.artifacts)) {
    if (!['requirement', 'context', 'impact', 'plan'].includes(name)) {
      throw new Error('Unsupported interview artifact: ' + name)
    }
    await atomicJsonWrite(resolve(paths.interviewDir, name + '.json'), value)
  }
  if (typeof input.markdown === 'string') {
    await atomicWrite(resolve(paths.interviewDir, 'plan.md'), input.markdown)
  }
  const event = await persistTransition(paths, loaded.events.at(-1), 'interview_finalized', record, {
    actor: input.actor,
    sourceFingerprint: input.currentSourceFingerprint,
    artifactDigests
  })
  return { ...loaded, record, event, artifactDigests, progress: interviewProgress(record, loaded.contextSnapshot) }
}
