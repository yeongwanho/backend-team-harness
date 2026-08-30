import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { canonicalJson } from './canonical-json.mjs'
import { buildSafeEnvironment } from './process-runner.mjs'
import { isHarnessRuntimePath } from './source-binding.mjs'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'

const MAX_RECORD_BYTES = 4 * 1024 * 1024
const MAX_IMPLEMENTED_FILES = 10_000
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_TOTAL_BYTES = 256 * 1024 * 1024
const MAX_GIT_OUTPUT = 8 * 1024 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function runGit(root, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], {
      env: buildSafeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = [], stderr = []
    let bytes = 0
    const capture = (target) => (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_GIT_OUTPUT) child.kill('SIGTERM')
      else target.push(chunk)
    }
    child.stdout.on('data', capture(stdout))
    child.stderr.on('data', capture(stderr))
    child.once('error', reject)
    child.once('close', (code) => {
      if (bytes > MAX_GIT_OUTPUT) return reject(new Error('Git integration inventory exceeded 8 MiB.'))
      if (code !== 0) return reject(new Error('Git integration inventory failed: ' + (Buffer.concat(stderr).toString('utf8').trim() || 'exit ' + code)))
      resolvePromise(Buffer.concat(stdout).toString('utf8'))
    })
  })
}

async function changedPathsAgainstBase(root, baseCommit) {
  if (typeof baseCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(baseCommit)) {
    throw new Error('Implementation record does not contain a valid immutable base commit.')
  }
  const [tracked, untracked] = await Promise.all([
    runGit(root, ['diff', '--name-only', '--no-renames', '-z', baseCommit, '--']),
    runGit(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'])
  ])
  return [...new Set((tracked + untracked).split('\0').filter((path) => path && !isHarnessRuntimePath(path)))].sort()
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

function portable(path) {
  return path.split(sep).join('/')
}

function reserveBytes(budget, bytes, path) {
  if (bytes > MAX_FILE_BYTES) throw new Error('Implemented file exceeds the 32 MiB evidence limit: ' + path)
  budget.bytes += bytes
  if (budget.bytes > MAX_TOTAL_BYTES) throw new Error('Implemented files exceed the 256 MiB aggregate evidence limit.')
}

async function hashRegularFile(path, displayPath, size, budget) {
  reserveBytes(budget, size, displayPath)
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    let bytes = 0
    stream.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > size || bytes > MAX_FILE_BYTES) {
        stream.destroy(new Error('Implemented file changed while being hashed: ' + displayPath))
        return
      }
      hash.update(chunk)
    })
    stream.once('end', () => {
      if (bytes !== size) reject(new Error('Implemented file changed while being hashed: ' + displayPath))
      else resolvePromise()
    })
    stream.once('error', reject)
  })
  return hash.digest('hex')
}

async function snapshotPath(root, path, budget) {
  const target = await resolveSafeProjectPath(root, path)
  const metadata = await statPath(target)
  if (!metadata) return { path, kind: 'missing', executable: null, contentSha256: null }
  if (!metadata.isFile()) throw new Error('Implemented path is not a regular file: ' + path)
  return {
    path,
    kind: 'file',
    executable: (metadata.mode & 0o111) !== 0,
    contentSha256: await hashRegularFile(target, path, metadata.size, budget)
  }
}

export async function snapshotImplementedFiles(root, paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_IMPLEMENTED_FILES) {
    throw new Error('Implemented file evidence must contain 1-' + MAX_IMPLEMENTED_FILES + ' paths.')
  }
  const normalized = [...new Set(paths)].sort()
  const budget = { bytes: 0 }
  const files = []
  for (const path of normalized) {
    if (typeof path !== 'string' || !path || path.includes('\0')) throw new Error('Implemented file evidence contains an invalid path.')
    const target = await resolveSafeProjectPath(root, path)
    const projectPath = portable(relative(root, target))
    if (projectPath !== path.replaceAll('\\', '/')) throw new Error('Implemented file evidence path is not canonical: ' + path)
    files.push(await snapshotPath(root, projectPath, budget))
  }
  return files
}

export async function implementationIntegrationStatus(root, record, options = {}) {
  if (!record || record.status !== 'passed') {
    return { integrated: false, reason: 'A passed implementation record is required.', mismatches: [] }
  }
  if (!Array.isArray(record.implementedFiles) || record.implementedFiles.length < 1) {
    return { integrated: false, reason: 'Implementation record does not contain file-level integration evidence.', mismatches: [] }
  }
  const paths = record.implementedFiles.map((entry) => entry?.path)
  const current = await snapshotImplementedFiles(root, paths)
  const expectedByPath = new Map(record.implementedFiles.map((entry) => [entry.path, entry]))
  const contentMismatches = current.filter((entry) => canonicalJson(entry) !== canonicalJson(expectedByPath.get(entry.path))).map((entry) => entry.path)
  const changedPaths = await changedPathsAgainstBase(root, record.baseHeadCommit)
  const expectedPaths = [...expectedByPath.keys()].sort()
  const changedSet = new Set(changedPaths)
  const expectedSet = new Set(expectedPaths)
  const extraPaths = changedPaths.filter((path) => !expectedSet.has(path))
  const missingPaths = expectedPaths.filter((path) => !changedSet.has(path))
  const currentSourceBinding = options.currentSourceBinding
  const explicitInputsChanged = currentSourceBinding
    ? canonicalJson(currentSourceBinding.explicitInputs ?? []) !== canonicalJson(record.baseExplicitInputs ?? [])
    : false
  const mismatches = [
    ...contentMismatches,
    ...extraPaths.map((path) => 'extra:' + path),
    ...missingPaths.map((path) => 'missing:' + path),
    ...(explicitInputsChanged ? ['declared-inputs'] : [])
  ]
  return {
    integrated: mismatches.length === 0,
    reason: mismatches.length === 0
      ? 'The complete Git change inventory and declared inputs match the passed isolated workspace evidence.'
      : 'Integrated source contains missing, altered, or additional changes relative to the passed implementation evidence.',
    mismatches: mismatches.slice(0, 64),
    mismatchCount: mismatches.length,
    changedPaths,
    extraPaths,
    missingPaths,
    explicitInputsChanged
  }
}

export async function loadImplementationRecord(root, taskId) {
  const path = await resolveSafeProjectPath(root, '.backend-harness/local/implementation/' + taskId + '.json')
  const metadata = await statPath(path)
  if (!metadata) return { path, record: null }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_RECORD_BYTES) {
    throw new Error('Implementation record is unsafe or exceeds 4 MiB.')
  }
  const record = JSON.parse(await readFile(path, 'utf8'))
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Implementation record must be a JSON object.')
  const { recordSha256, ...unsigned } = record
  if (recordSha256 !== sha256(canonicalJson(unsigned)) || record.taskId !== taskId) throw new Error('Implementation record seal is invalid.')
  return { path, record }
}

export async function saveImplementationRecord(path, record) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const sealed = { ...record, recordSha256: sha256(canonicalJson(record)) }
  await atomicJson(path, sealed)
  return sealed
}
