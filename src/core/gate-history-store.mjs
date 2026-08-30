import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import {
  assertNoSymlinkSegments,
  resolveReadableRoot,
  resolveSafeProjectPath,
  statPath
} from '../fs-safety.mjs'
import { gateSignature } from './gate-scheduler.mjs'

const RELATIVE_PATH = '.backend-harness/local/optimization/gate-history.json'
const MAX_BYTES = 1024 * 1024
const MAX_GATES = 512
const MAX_SAMPLES = 1_000_000_000
const GATE_ID = /^[a-z][a-z0-9-]{0,63}$/
const SHA256 = /^[a-f0-9]{64}$/

function invalid(root, diagnostic) {
  return {
    root,
    path: RELATIVE_PATH,
    status: 'invalid',
    diagnostic,
    entries: [],
    updated: false
  }
}

function validateEntry(entry, index) {
  const label = 'gates[' + index + ']'
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(label + ' must be an object.')
  }
  const allowed = new Set(['signature', 'gateId', 'samples', 'failures', 'totalDurationMs', 'lastObservedAt'])
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) {
      throw new Error(label + ' contains unknown key: ' + key)
    }
  }
  if (typeof entry.signature !== 'string' || !SHA256.test(entry.signature)) {
    throw new Error(label + '.signature is invalid.')
  }
  if (typeof entry.gateId !== 'string' || !GATE_ID.test(entry.gateId)) {
    throw new Error(label + '.gateId is invalid.')
  }
  if (!Number.isSafeInteger(entry.samples) || entry.samples < 1 || entry.samples > MAX_SAMPLES) {
    throw new Error(label + '.samples is out of range.')
  }
  if (!Number.isSafeInteger(entry.failures) || entry.failures < 0 || entry.failures > entry.samples) {
    throw new Error(label + '.failures is out of range.')
  }
  if (!Number.isSafeInteger(entry.totalDurationMs) || entry.totalDurationMs < 0) {
    throw new Error(label + '.totalDurationMs is out of range.')
  }
  if (typeof entry.lastObservedAt !== 'string' || !Number.isFinite(Date.parse(entry.lastObservedAt))) {
    throw new Error(label + '.lastObservedAt is invalid.')
  }
  return {
    signature: entry.signature,
    gateId: entry.gateId,
    samples: entry.samples,
    failures: entry.failures,
    totalDurationMs: entry.totalDurationMs,
    lastObservedAt: entry.lastObservedAt
  }
}

function parseHistory(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('invalid JSON: ' + error.message)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('history must be an object.')
  }
  for (const key of Object.keys(parsed)) {
    if (!['schemaVersion', 'updatedAt', 'gates'].includes(key)) {
      throw new Error('history contains unknown key: ' + key)
    }
  }
  if (parsed.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1.')
  }
  if (typeof parsed.updatedAt !== 'string' || !Number.isFinite(Date.parse(parsed.updatedAt))) {
    throw new Error('updatedAt is invalid.')
  }
  if (!Array.isArray(parsed.gates) || parsed.gates.length > MAX_GATES) {
    throw new Error('gates must contain at most ' + MAX_GATES + ' entries.')
  }
  const entries = parsed.gates.map(validateEntry)
  if (new Set(entries.map((entry) => entry.signature)).size !== entries.length) {
    throw new Error('gate signatures must be unique.')
  }
  return { updatedAt: parsed.updatedAt, entries }
}

export async function loadGateHistory(inputPath) {
  const root = await resolveReadableRoot(inputPath)
  let target
  try {
    target = await resolveSafeProjectPath(root, RELATIVE_PATH)
  } catch (error) {
    return invalid(root, 'history path is unsafe: ' + (error instanceof Error ? error.message : String(error)))
  }
  const metadata = await statPath(target)
  if (!metadata) {
    return { root, path: RELATIVE_PATH, status: 'missing', diagnostic: null, entries: [], updated: false }
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return invalid(root, 'history path is not a regular non-symbolic link file.')
  }
  if (metadata.size > MAX_BYTES) {
    return invalid(root, 'history file exceeds the ' + MAX_BYTES + '-byte limit.')
  }
  try {
    const parsed = parseHistory(await readFile(target, 'utf8'))
    return {
      root,
      path: relative(root, target),
      status: 'available',
      diagnostic: null,
      entries: parsed.entries,
      updatedAt: parsed.updatedAt,
      updated: false
    }
  } catch (error) {
    return invalid(root, error instanceof Error ? error.message : String(error))
  }
}

async function atomicWrite(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function recordGateObservations(inputPath, loaded, observations, options = {}) {
  if (loaded?.status === 'invalid') {
    return { ...loaded, updated: false }
  }
  const root = await resolveReadableRoot(inputPath)
  const at = options.at ?? new Date()
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new Error('Observation time must be a valid Date.')
  }
  if (!Array.isArray(observations) || observations.length > 32) {
    throw new Error('Gate observations must contain at most 32 entries.')
  }
  const entries = new Map((loaded?.entries ?? []).map((entry) => [entry.signature, { ...entry }]))
  const observedSignatures = new Set()
  for (const [index, observation] of observations.entries()) {
    if (!observation?.gate || !['passed', 'failed'].includes(observation.outcome)) {
      throw new Error('observations[' + index + '] is invalid.')
    }
    if (!Number.isSafeInteger(observation.durationMs) || observation.durationMs < 0) {
      throw new Error('observations[' + index + '].durationMs must be a non-negative integer.')
    }
    const signature = gateSignature(observation.gate)
    observedSignatures.add(signature)
    const previous = entries.get(signature) ?? {
      signature,
      gateId: observation.gate.id,
      samples: 0,
      failures: 0,
      totalDurationMs: 0,
      lastObservedAt: at.toISOString()
    }
    if (previous.samples >= MAX_SAMPLES || !Number.isSafeInteger(previous.totalDurationMs + observation.durationMs)) {
      return {
        ...loaded,
        root,
        status: loaded?.status ?? 'missing',
        diagnostic: 'history numeric capacity reached; observation was not recorded.',
        updated: false
      }
    }
    entries.set(signature, {
      ...previous,
      samples: previous.samples + 1,
      failures: previous.failures + (observation.outcome === 'failed' ? 1 : 0),
      totalDurationMs: previous.totalDurationMs + observation.durationMs,
      lastObservedAt: at.toISOString()
    })
  }
  let evicted = 0
  if (entries.size > MAX_GATES) {
    const candidates = [...entries.values()]
      .filter((entry) => !observedSignatures.has(entry.signature))
      .sort((left, right) => {
        return Date.parse(left.lastObservedAt) - Date.parse(right.lastObservedAt) ||
          left.signature.localeCompare(right.signature)
      })
    while (entries.size > MAX_GATES && candidates.length > 0) {
      entries.delete(candidates.shift().signature)
      evicted += 1
    }
    if (entries.size > MAX_GATES) {
      return {
        ...loaded,
        root,
        diagnostic: 'history gate capacity reached; observation was not recorded.',
        updated: false
      }
    }
  }
  const normalized = [...entries.values()].sort((left, right) => left.signature.localeCompare(right.signature))
  const target = await resolveSafeProjectPath(root, RELATIVE_PATH)
  await mkdir(dirname(target), { recursive: true })
  await assertNoSymlinkSegments(root, target)
  await atomicWrite(target, JSON.stringify({
    schemaVersion: 1,
    updatedAt: at.toISOString(),
    gates: normalized
  }, null, 2) + '\n')
  return {
    root,
    path: relative(root, target),
    status: 'available',
    diagnostic: evicted > 0
      ? 'evicted ' + evicted + ' stale signature' + (evicted === 1 ? '' : 's') + ' to preserve bounded history.'
      : null,
    entries: normalized,
    updatedAt: at.toISOString(),
    updated: observations.length > 0
  }
}
