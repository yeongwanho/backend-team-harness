import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { buildSafeEnvironment } from './process-runner.mjs'
import { manifestJvmPaths } from './project-manifest.mjs'

const RELATIVE_PATH = '.backend-harness/local/cache/jvm-index.json'
const MAX_CACHE_BYTES = 128 * 1024 * 1024
const MAX_GIT_BYTES = 64 * 1024 * 1024
const SHA256 = /^[a-f0-9]{64}$/

function portable(path) {
  return path.split(sep).join('/')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function cacheResult(root, status, diagnostic = null, extra = {}) {
  return { root, path: RELATIVE_PATH, status, diagnostic, ...extra }
}

function runGit(root, args, input = null, acceptedExitCodes = [0]) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], {
      env: buildSafeEnvironment(),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    let overflow = false
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_GIT_BYTES) {
        overflow = true
        child.kill('SIGTERM')
      } else {
        stdout.push(chunk)
      }
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (overflow) {
        reject(new Error('Git cache eligibility output exceeded the 64 MiB safety limit.'))
      } else if (!acceptedExitCodes.includes(code)) {
        reject(new Error('Git cache eligibility check failed: ' + (Buffer.concat(stderr).toString('utf8').trim() || 'exit ' + code)))
      } else {
        resolvePromise(Buffer.concat(stdout))
      }
    })
    if (input) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

function stringArray(value, label, limit = 100_000) {
  if (!Array.isArray(value) || value.length > limit || value.some((entry) => typeof entry !== 'string' || entry.length > 4096)) {
    throw new Error(label + ' is invalid.')
  }
  return value
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + ' must be a non-negative safe integer.')
  }
  return value
}

function validateProjectPath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(label + ' is not a portable project-relative path.')
  }
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(label + ' contains an unsafe path segment.')
  }
}

function validateJvmIndex(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index) || index.schemaVersion !== 1) {
    throw new Error('Cached JVM index schemaVersion must be 1.')
  }
  if (!index.metrics || typeof index.metrics !== 'object' || Array.isArray(index.metrics)) {
    throw new Error('Cached JVM index metrics are missing.')
  }
  for (const key of ['visitedEntries', 'skippedSymlinks', 'files', 'oversizedFiles', 'bytes', 'declarations', 'imports', 'routes', 'entities', 'tests']) {
    nonNegativeInteger(index.metrics[key], 'Cached JVM index metrics.' + key)
  }
  if (!Array.isArray(index.files) || index.files.length > 100_000) {
    throw new Error('Cached JVM index files must contain at most 100000 entries.')
  }
  const observedRoles = new Set()
  const observedTables = new Set()
  const observedPackages = new Set()
  let declarations = 0
  let imports = 0
  let routes = 0
  let entities = 0
  let tests = 0
  let previousPath = null
  for (const [fileIndex, file] of index.files.entries()) {
    const label = 'Cached JVM index files[' + fileIndex + ']'
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(label + ' must be an object.')
    }
    validateProjectPath(file.path, label + '.path')
    if (previousPath !== null && file.path <= previousPath) {
      throw new Error('Cached JVM index file paths must be unique and sorted.')
    }
    previousPath = file.path
    if (!SHA256.test(file.contentSha256 ?? '') || !['java', 'kotlin'].includes(file.language) || typeof file.packageName !== 'string' || file.packageName.length > 4096) {
      throw new Error(label + ' language or package is invalid.')
    }
    const fileRoles = stringArray(file.roles, label + '.roles', 64)
    const fileTables = stringArray(file.tables, label + '.tables', 4096)
    stringArray(file.annotations, label + '.annotations', 4096)
    stringArray(file.imports, label + '.imports', 100_000)
    if (!Array.isArray(file.declarations) || file.declarations.length > 100_000 || file.declarations.some((entry) => {
      return !entry || typeof entry !== 'object' || typeof entry.kind !== 'string' || typeof entry.name !== 'string' || typeof entry.qualifiedName !== 'string'
    })) {
      throw new Error(label + '.declarations is invalid.')
    }
    if (!Array.isArray(file.routes) || file.routes.length > 100_000 || file.routes.some((entry) => {
      return !entry || typeof entry !== 'object' || typeof entry.method !== 'string' || typeof entry.path !== 'string'
    })) {
      throw new Error(label + '.routes is invalid.')
    }
    declarations += file.declarations.length
    imports += file.imports.length
    routes += file.routes.length
    if (fileRoles.includes('entity')) entities += 1
    if (fileRoles.includes('test')) tests += 1
    for (const role of fileRoles) observedRoles.add(role)
    for (const table of fileTables) observedTables.add(table)
    if (file.packageName) observedPackages.add(file.packageName)
  }
  const roles = stringArray(index.roles, 'Cached JVM index roles', 64)
  const tables = stringArray(index.tables, 'Cached JVM index tables')
  const packages = stringArray(index.packages, 'Cached JVM index packages')
  const expected = {
    files: index.files.length,
    declarations,
    imports,
    routes,
    entities,
    tests
  }
  for (const [key, value] of Object.entries(expected)) {
    if (index.metrics[key] !== value) {
      throw new Error('Cached JVM index metrics.' + key + ' does not match its file entries.')
    }
  }
  for (const key of ['readBytes', 'parsedFiles', 'reusedFiles']) {
    nonNegativeInteger(index.metrics[key], 'Cached JVM index metrics.' + key)
  }
  if (index.metrics.parsedFiles + index.metrics.reusedFiles !== index.metrics.files || index.metrics.readBytes > index.metrics.bytes) {
    throw new Error('Cached JVM index reuse metrics are inconsistent.')
  }
  if (!index.authority || index.authority.evidenceTier !== 'REPORTED' || index.authority.provenance !== 'bounded-source-patterns' || index.authority.semanticCompilerIndex !== false) {
    throw new Error('Cached JVM index authority is invalid.')
  }
  if (JSON.stringify(roles) !== JSON.stringify([...observedRoles].sort()) ||
      JSON.stringify(tables) !== JSON.stringify([...observedTables].sort()) ||
      JSON.stringify(packages) !== JSON.stringify([...observedPackages].sort())) {
    throw new Error('Cached JVM index aggregate lists do not match its file entries.')
  }
  stringArray(index.limitations, 'Cached JVM index limitations', 64)
  return index
}

async function cacheEligibility(root, manifest) {
  if (!manifest || manifest.root !== root || manifest.truncated || manifest.unreadableDirectories > 0) {
    return { eligible: false, diagnostic: 'cache requires one complete readable project manifest.' }
  }
  const jvmPaths = manifestJvmPaths(manifest)
  if (jvmPaths.length === 0) {
    return { eligible: true, diagnostic: null }
  }
  const input = Buffer.from(jvmPaths.join('\0') + '\0')
  if (input.length > MAX_GIT_BYTES) {
    return { eligible: false, diagnostic: 'JVM path input exceeds the 64 MiB cache eligibility limit.' }
  }
  const [ignoredOutput, stagedOutput, trackedFlagsOutput] = await Promise.all([
    runGit(root, ['check-ignore', '-z', '--stdin'], input, [0, 1]),
    runGit(root, ['ls-files', '--stage', '-z']),
    runGit(root, ['ls-files', '-v', '-z'])
  ])
  const ignored = ignoredOutput.toString('utf8').split('\0').filter(Boolean)
  if (ignored.length > 0) {
    return {
      eligible: false,
      diagnostic: 'cache disabled because ' + ignored.length + ' indexed JVM source path' + (ignored.length === 1 ? ' is' : 's are') + ' ignored by Git.'
    }
  }
  const submodules = stagedOutput.toString('utf8').split('\0').filter(Boolean).flatMap((entry) => {
    const match = entry.match(/^160000 [a-f0-9]+ \d\t(.+)$/i)
    return match ? [portable(match[1])] : []
  })
  const indexedSubmodule = submodules.find((submodule) => jvmPaths.some((path) => path === submodule || path.startsWith(submodule + '/')))
  if (indexedSubmodule) {
    return { eligible: false, diagnostic: 'cache disabled because indexed JVM sources exist inside submodule ' + indexedSubmodule + '.' }
  }
  const jvmPathSet = new Set(jvmPaths)
  const nonordinaryTrackedPath = trackedFlagsOutput.toString('utf8').split('\0').filter(Boolean).find((entry) => {
    const match = entry.match(/^(\S) (.+)$/s)
    return match && match[1] !== 'H' && jvmPathSet.has(portable(match[2]))
  })
  if (nonordinaryTrackedPath) {
    return { eligible: false, diagnostic: 'cache disabled because a tracked JVM source uses a nonordinary Git index flag.' }
  }
  return { eligible: true, diagnostic: null }
}

function parseRecord(text) {
  let record
  try {
    record = JSON.parse(text)
  } catch (error) {
    throw new Error('cache JSON is invalid: ' + error.message)
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('cache record must be an object.')
  }
  const allowed = new Set(['schemaVersion', 'sourceFingerprint', 'headCommit', 'generatedAt', 'index', 'recordSha256'])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('cache record contains an unknown key.')
  }
  if (record.schemaVersion !== 2 || typeof record.sourceFingerprint !== 'string' || !SHA256.test(record.sourceFingerprint) || !/^[a-f0-9]{40,64}$/.test(record.headCommit ?? '')) {
    throw new Error('cache identity is invalid.')
  }
  if (typeof record.generatedAt !== 'string' || !Number.isFinite(Date.parse(record.generatedAt))) {
    throw new Error('cache generatedAt is invalid.')
  }
  const { recordSha256, ...unsigned } = record
  if (!SHA256.test(recordSha256 ?? '') || recordSha256 !== sha256(JSON.stringify(unsigned))) {
    throw new Error('cache seal does not match its content.')
  }
  validateJvmIndex(record.index)
  return record
}

export async function loadJvmIndexCache(inputPath, sourceFingerprint, manifest) {
  const root = await resolveReadableRoot(inputPath)
  let target
  try {
    target = await resolveSafeProjectPath(root, RELATIVE_PATH)
  } catch (error) {
    return cacheResult(root, 'invalid', 'cache path is unsafe: ' + (error instanceof Error ? error.message : String(error)))
  }
  const metadata = await statPath(target)
  if (!metadata) {
    return cacheResult(root, 'missing')
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return cacheResult(root, 'invalid', 'cache path is not a regular non-symbolic link file.')
  }
  if (metadata.size > MAX_CACHE_BYTES) {
    return cacheResult(root, 'invalid', 'cache exceeds the 128 MiB safety limit.')
  }
  let record
  try {
    record = parseRecord(await readFile(target, 'utf8'))
  } catch (error) {
    return cacheResult(root, 'invalid', error instanceof Error ? error.message : String(error))
  }
  let eligibility
  try {
    eligibility = await cacheEligibility(root, manifest)
  } catch (error) {
    return cacheResult(root, 'unavailable', error instanceof Error ? error.message : String(error))
  }
  if (!eligibility.eligible) {
    return cacheResult(root, 'unsupported', eligibility.diagnostic)
  }
  if (record.sourceFingerprint !== sourceFingerprint) {
    return cacheResult(root, 'stale', 'cache belongs to a different source fingerprint.', {
      generatedAt: record.generatedAt,
      cachedHeadCommit: record.headCommit,
      index: record.index
    })
  }
  return cacheResult(root, 'hit', null, { generatedAt: record.generatedAt, index: record.index })
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

export async function writeJvmIndexCache(inputPath, sourceBinding, index, manifest, options = {}) {
  const root = await resolveReadableRoot(inputPath)
  const sourceFingerprint = sourceBinding?.fingerprint
  if (typeof sourceFingerprint !== 'string' || !SHA256.test(sourceFingerprint)) {
    throw new Error('A valid source fingerprint is required to write the JVM index cache.')
  }
  if (typeof sourceBinding?.headCommit !== 'string' || !/^[a-f0-9]{40,64}$/.test(sourceBinding.headCommit)) {
    throw new Error('A valid source HEAD commit is required to write the JVM index cache.')
  }
  validateJvmIndex(index)
  if (index.metrics.oversizedFiles > 0) {
    return cacheResult(root, 'unsupported', 'cache disabled because oversized JVM sources make the index incomplete.', { written: false })
  }
  if (JSON.stringify(index.files.map((file) => file.path)) !== JSON.stringify(manifestJvmPaths(manifest))) {
    throw new Error('JVM index paths do not match the project manifest; retry warm-cache on a stable worktree.')
  }
  const eligibility = await cacheEligibility(root, manifest)
  if (!eligibility.eligible) {
    return cacheResult(root, 'unsupported', eligibility.diagnostic, { written: false })
  }
  const generatedAt = (options.at ?? new Date()).toISOString()
  const unsigned = { schemaVersion: 2, sourceFingerprint, headCommit: sourceBinding.headCommit, generatedAt, index }
  const record = { ...unsigned, recordSha256: sha256(JSON.stringify(unsigned)) }
  const content = JSON.stringify(record) + '\n'
  if (Buffer.byteLength(content) > MAX_CACHE_BYTES) {
    return cacheResult(root, 'unsupported', 'cache output exceeds the 128 MiB safety limit.', { written: false })
  }
  const harnessRoot = await resolveSafeProjectPath(root, '.backend-harness')
  const harnessStat = await statPath(harnessRoot)
  if (!harnessStat?.isDirectory() || harnessStat.isSymbolicLink()) {
    throw new Error('Shared contract is missing. Run `bth init <path>` first.')
  }
  const target = await resolveSafeProjectPath(root, RELATIVE_PATH)
  await mkdir(dirname(target), { recursive: true })
  await assertNoSymlinkSegments(root, target)
  await atomicWrite(target, content)
  return cacheResult(root, 'written', null, {
    written: true,
    generatedAt,
    sourceFingerprint,
    bytes: Buffer.byteLength(content),
    metrics: index.metrics,
    path: portable(relative(root, target))
  })
}
