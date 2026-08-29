import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { assertNoSymlinkSegments, statPath } from '../fs-safety.mjs'
import { canonicalJson } from './canonical-json.mjs'
import {
  answerInterviewRecord,
  createInterviewRecord,
  finalizeInterviewRecord,
  interviewProgress
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
    contextPath: resolve(interviewDir, 'context-snapshot.json')
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
    progress: interviewProgress(record)
  }
}

export async function loadInterview(inputPath, taskId) {
  const paths = await interviewPaths(inputPath, taskId)
  const directoryStat = await statPath(paths.interviewDir)
  if (!directoryStat?.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Interview does not exist for task: ' + taskId)
  }
  for (const path of [paths.eventPath, paths.contextPath]) {
    await assertNoSymlinkSegments(paths.interviewDir, path)
    const metadata = await statPath(path)
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 16 * 1024 * 1024) {
      throw new Error('Interview file is missing, unsafe, or too large: ' + relative(paths.root, path))
    }
  }
  const events = parseEvents(await readFile(paths.eventPath, 'utf8'), taskId)
  const record = events.at(-1).record
  const contextSnapshot = JSON.parse(await readFile(paths.contextPath, 'utf8'))
  if (sha256(contextSnapshot) !== record.contextSnapshotSha256) {
    throw new Error('Interview project-context snapshot has been altered: ' + taskId)
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
    progress: interviewProgress(record)
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
  return { ...loaded, record, event, progress: interviewProgress(record) }
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
    artifactDigests
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
  return { ...loaded, record, event, artifactDigests, progress: interviewProgress(record) }
}
