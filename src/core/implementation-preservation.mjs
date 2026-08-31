import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { buildSafeEnvironment } from './process-runner.mjs'
import { redactString } from './redaction.mjs'

const execute = promisify(execFile)
const MAX_FILES = 32, MAX_BYTES = 65536
const statuses = new Set(['not-applicable', 'clear', 'review-required', 'incomplete'])
const codes = new Set(['relationship_guard_drift', 'java_structure_unavailable', 'preservation_input_unavailable'])
const hash = value => createHash('sha256').update(value).digest('hex')
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
const line = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_BYTES ? value : null
const pathValue = value => typeof value === 'string' && value.length <= 384 &&
  /^[^\x00-\x1f\x7f<>:"'|?*=\\]+\.java$/.test(value) && !value.startsWith('/') &&
  !value.split('/').some(part => !part || part === '.' || part === '..') && redactString(value).count === 0 ? value : null

export const preservationGuidance = Object.freeze({
  scope: 'changed-java-direct-relationship-writes',
  instruction: 'Inspect existing relationship mutators before changing collection writes. Preserve their guards unless the approved requirement intentionally changes that behavior; test existing members and attempts to use a non-member identifier. Changed guards require exact-candidate review before apply, not blind restoration of old behavior. Normal required tests still run. Structural review is not proof of authorization.',
  limitation: 'No cross-file call, alias, inheritance, early-return or semantic ownership analysis.'
})

export function preservationGuidanceFor(gates, paths = []) {
  const jvm = gates.some(gate => /(?:^|\/)(?:gradlew|mvnw)(?:\.bat|\.cmd)?$/.test(gate.command?.[0]?.replaceAll('\\', '/') ?? ''))
  return jvm || paths.some(path => typeof path === 'string' && path.endsWith('.java')) ? preservationGuidance : null
}

export function compactPreservation(value) {
  if (value?.schemaVersion !== 1 || !statuses.has(value.status) || !Array.isArray(value.files)) return null
  return {
    schemaVersion: 1, authority: 'structural-review-not-semantic-proof', status: value.status,
    omittedFileCount: Math.max(0, value.files.length - MAX_FILES) + (Number.isSafeInteger(value.omittedFileCount) && value.omittedFileCount >= 0 ? value.omittedFileCount : 0),
    files: value.files.slice(0, MAX_FILES).map(file => ({
      path: pathValue(file?.path), baseSha256: sha(file?.baseSha256), candidateSha256: sha(file?.candidateSha256),
      status: statuses.has(file?.status) ? file.status : 'incomplete',
      findings: Array.isArray(file?.findings) ? file.findings.slice(0, 16).filter(item => codes.has(item?.code)).map(item => ({
        code: item.code, line: line(item.line), baselineLine: line(item.baselineLine)
      })) : []
    }))
  }
}

async function readCandidate(root, path) {
  const absolute = await resolveSafeProjectPath(root, path)
  const metadata = await statPath(absolute)
  if (!metadata) return '' // deletion; not a new direct collection write
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BYTES) throw new Error('input-unavailable')
  const file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_BYTES) throw new Error('input-unavailable')
    const bytes = buffer.subarray(0, bytesRead)
    const text = bytes.toString('utf8')
    if (!Buffer.from(text).equals(bytes)) throw new Error('input-unavailable')
    return text
  } finally { await file.close() }
}

async function git(root, args) {
  const { stdout } = await execute('git', ['-C', root, ...args], {
    env: buildSafeEnvironment(), encoding: 'buffer', maxBuffer: MAX_BYTES + 1, timeout: 5000, windowsHide: true
  })
  const text = stdout.toString('utf8')
  if (stdout.length > MAX_BYTES || !Buffer.from(text).equals(stdout)) throw new Error('input-unavailable')
  return text
}

function parsePairs(pairs) {
  return new Promise((resolvePromise) => {
    let worker
    try {
      worker = new Worker(new URL('../adapters/java-preservation-worker.mjs', import.meta.url), {
        workerData: pairs, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
        execArgv: [], stdout: true, stderr: true
      })
    } catch { resolvePromise(null); return }
    // Parser failures must never leak source through a worker's error text/stdout.
    worker.stdout.resume(); worker.stderr.resume()
    let finished = false
    const finish = async value => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      await worker.terminate().catch(() => {})
      resolvePromise(value)
    }
    const timer = setTimeout(() => { void finish(null) }, 5000)
    worker.once('message', value => { void finish(value) })
    worker.once('error', () => { void finish(null) })
    worker.once('exit', () => { void finish(null) })
  })
}

export async function checkImplementationPreservation(root, baseCommit, changedPaths) {
  const selected = [...new Set(changedPaths.filter(path => typeof path === 'string' && path.endsWith('.java')))]
  const files = [], pairs = [], indexes = []
  for (const path of selected.slice(0, MAX_FILES)) {
    const file = { path, baseSha256: null, candidateSha256: null, status: 'not-applicable', findings: [] }
    files.push(file)
    try {
      if (!pathValue(path) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) throw new Error('input-unavailable')
      const after = await readCandidate(root, path)
      file.candidateSha256 = hash(after)
      const tree = await git(root, ['ls-tree', '-z', baseCommit, '--', ':(literal)' + path])
      if (!tree) continue // new file has no baseline guard to preserve
      const entry = tree.match(/^100(?:644|755) blob ([a-f0-9]{40,64})\t[^\0]+\0$/)
      if (!entry) throw new Error('input-unavailable')
      const before = await git(root, ['cat-file', 'blob', entry[1]])
      file.baseSha256 = hash(before)
      if (before === after) continue
      // A negative prefilter saves parser startup for ordinary Java edits. Unicode
      // escapes remain parse candidates; comments may trigger parsing, never a finding.
      if (!/@(?:[\w$]+\.)*(?:OneToMany|ManyToMany|ElementCollection)\b/.test(before) && !before.includes('\\u')) continue
      pairs.push({ before, after }); indexes.push(files.length - 1)
    } catch {
      file.status = 'incomplete'
      file.findings = [{ code: 'preservation_input_unavailable', line: null, baselineLine: null }]
    }
  }
  if (pairs.length) {
    const analyses = await parsePairs(pairs)
    for (let i = 0; i < indexes.length; i++) {
      const analysis = analyses?.[i]
      Object.assign(files[indexes[i]], analysis && statuses.has(analysis.status) ? analysis : {
        status: 'incomplete', findings: [{ code: 'java_structure_unavailable', line: null, baselineLine: null }]
      })
    }
  }
  const omittedFileCount = Math.max(0, selected.length - MAX_FILES)
  const status = omittedFileCount || files.some(file => file.status === 'incomplete') ? 'incomplete'
    : files.some(file => file.status === 'review-required') ? 'review-required'
      : files.some(file => file.status === 'clear') ? 'clear' : 'not-applicable'
  return compactPreservation({ schemaVersion: 1, status, files, omittedFileCount })
}

export const preservationNeedsReview = result => !result || ['incomplete', 'review-required'].includes(result.status)

export function preservationFailure(preservation, sourceFingerprint = null) {
  return {
    confirmed: false, sourceFingerprint, runPath: null, tests: null, gates: [], preservation,
    failure: {
      code: 'implementation_preservation_review_required',
      message: 'Bounded Java structural inspection could not complete. Inspect the cited inputs or parsing limits; missing evidence cannot be waived by a review acknowledgement. This is structural uncertainty, not proof of an authorization bug.'
    }
  }
}
