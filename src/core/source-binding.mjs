import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { buildSafeEnvironment } from './process-runner.mjs'
import { canonicalJson } from './canonical-json.mjs'

const RUNTIME_EXCLUDES = [
  ':(exclude).backend-harness/tasks/**',
  ':(exclude).backend-harness/local/**',
  ':(exclude).backend-harness/generated/**'
]
const RUNTIME_PREFIXES = [
  '.backend-harness/tasks/',
  '.backend-harness/local/',
  '.backend-harness/generated/'
]

export function isHarnessRuntimePath(path) {
  return typeof path === 'string' && RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
}
const MAX_BOUND_FILE_BYTES = 32 * 1024 * 1024
const MAX_BOUND_TOTAL_BYTES = 256 * 1024 * 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function runGit(root, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', root, ...args], {
      env: buildSafeEnvironment(),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
    let overflow = false
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        overflow = true
        child.kill('SIGTERM')
      } else {
        stdout.push(chunk)
      }
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (exitCode) => {
      if (overflow) {
        reject(new Error('Git source binding exceeded the 64 MiB safety limit. Commit or reduce the working diff before verification.'))
        return
      }
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (exitCode !== 0) {
        reject(new Error('Git source binding failed: ' + (errorText || 'git exited with code ' + exitCode)))
        return
      }
      resolvePromise(Buffer.concat(stdout))
    })
  })
}

function ensureInside(root, target) {
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith('..' + sep) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))) {
    return
  }
  throw new Error('Git reported a path outside its worktree.')
}

function filteredHeadManifest(output) {
  const entries = output.toString('utf8').split('\0').filter(Boolean).filter((entry) => {
    const separator = entry.indexOf('\t')
    if (separator < 0) {
      throw new Error('Git returned an invalid HEAD manifest entry.')
    }
    const projectRelativePath = entry.slice(separator + 1)
    return !RUNTIME_PREFIXES.some((prefix) => projectRelativePath.startsWith(prefix))
  })
  return Buffer.from(entries.join('\0') + (entries.length ? '\0' : ''))
}

function reserveBoundBytes(budget, bytes, path) {
  if (bytes > MAX_BOUND_FILE_BYTES) {
    throw new Error('Source input exceeds the 32 MiB source-binding limit: ' + path)
  }
  budget.bytes += bytes
  if (budget.bytes > MAX_BOUND_TOTAL_BYTES) {
    throw new Error('Source inputs exceed the 256 MiB aggregate source-binding limit.')
  }
}

async function hashFileEntry(gitRoot, path, budget) {
  const target = resolve(gitRoot, path)
  ensureInside(gitRoot, target)
  const stat = await lstat(target)
  const contentHash = createHash('sha256')
  let kind
  if (stat.isSymbolicLink()) {
    kind = 'symlink'
    const link = await readlink(target)
    reserveBoundBytes(budget, Buffer.byteLength(link), path)
    contentHash.update(link)
  } else if (stat.isFile()) {
    kind = 'file'
    reserveBoundBytes(budget, stat.size, path)
    await new Promise((resolvePromise, reject) => {
      const stream = createReadStream(target)
      let readBytes = 0
      let reservedBytes = stat.size
      stream.on('data', (chunk) => {
        try {
          readBytes += chunk.length
          if (readBytes > MAX_BOUND_FILE_BYTES) {
            throw new Error('Source input exceeds the 32 MiB source-binding limit while being read: ' + path)
          }
          if (readBytes > reservedBytes) {
            reserveBoundBytes(budget, readBytes - reservedBytes, path)
            reservedBytes = readBytes
          }
          contentHash.update(chunk)
        } catch (error) {
          stream.destroy(error)
        }
      })
      stream.once('end', resolvePromise)
      stream.once('error', reject)
    })
  } else {
    throw new Error('Unsupported untracked filesystem entry: ' + path)
  }
  return {
    pathSha256: sha256(path.split(sep).join('/')),
    kind,
    contentSha256: contentHash.digest('hex')
  }
}

async function hashDeclaredInput(gitRoot, projectRoot, path, budget, options = {}) {
  const target = resolve(projectRoot, path)
  ensureInside(projectRoot, target)
  const projectRelative = relative(projectRoot, target).split(sep).join('/')
  let current = projectRoot
  for (const segment of projectRelative.split('/').filter(Boolean)) {
    current = resolve(current, segment)
    const metadata = await lstat(current)
    if (metadata.isSymbolicLink()) {
      if (options.allowSymlink !== true) {
        throw new Error('Declared verification input cannot use a symbolic link: ' + path)
      }
      const link = await readlink(current)
      reserveBoundBytes(budget, Buffer.byteLength(link), path)
      return {
        pathSha256: sha256(relative(gitRoot, target).split(sep).join('/')),
        kind: 'symlink',
        contentSha256: sha256(link)
      }
    }
  }
  return hashFileEntry(gitRoot, relative(gitRoot, target), budget)
}

export async function captureSourceBinding(inputPath, options = {}) {
  const gitRoot = await realpath((await runGit(inputPath, ['rev-parse', '--show-toplevel'])).toString('utf8').trim())
  const headCommit = (await runGit(inputPath, ['rev-parse', 'HEAD'])).toString('utf8').trim()
  if (!/^[a-f0-9]{40,64}$/i.test(headCommit)) {
    throw new Error('Git HEAD did not resolve to a commit.')
  }

  const resolvedInput = await realpath(resolve(inputPath))
  ensureInside(gitRoot, resolvedInput)
  const projectPath = relative(gitRoot, resolvedInput).split(sep).join('/') || '.'
  const pathspec = ['--', '.', ...RUNTIME_EXCLUDES]
  const [rawHeadManifest, status, trackedDiff, untrackedOutput] = await Promise.all([
    runGit(inputPath, ['ls-tree', '-r', '-z', 'HEAD', '--', '.']),
    runGit(inputPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', ...pathspec]),
    runGit(inputPath, ['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', ...pathspec]),
    runGit(inputPath, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z', ...pathspec])
  ])
  const headManifest = filteredHeadManifest(rawHeadManifest)

  const untrackedPaths = untrackedOutput
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort()
  const untracked = []
  const boundBytes = { bytes: 0 }
  for (const path of untrackedPaths) {
    untracked.push(await hashFileEntry(gitRoot, path, boundBytes))
  }

  const explicitInputs = []
  const explicitPaths = [...new Set(options.explicitPaths ?? [])].sort()
  const allowSymlinkPaths = new Set(options.allowSymlinkPaths ?? [])
  for (const path of explicitPaths) {
    try {
      explicitInputs.push(await hashDeclaredInput(gitRoot, resolvedInput, path, boundBytes, {
        allowSymlink: allowSymlinkPaths.has(path)
      }))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('Declared verification input is missing: ' + path)
      }
      throw error
    }
  }

  const sharedIdentity = {
    projectPath,
    clean: status.length === 0,
    changedEntryCount: status.toString('utf8').split('\0').filter(Boolean).length,
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    untracked,
    explicitInputs
  }
  const identity = {
    schemaVersion: 2,
    projectHeadManifestSha256: sha256(headManifest),
    ...sharedIdentity
  }
  const legacyIdentity = {
    schemaVersion: 1,
    headCommit: headCommit.toLowerCase(),
    ...sharedIdentity
  }
  return {
    ...identity,
    headCommit: headCommit.toLowerCase(),
    legacyFingerprint: sha256(canonicalJson(legacyIdentity)),
    fingerprint: sha256(canonicalJson(identity))
  }
}

export function sourceBindingMatchesFingerprint(current, recordedFingerprint) {
  return typeof recordedFingerprint === 'string' &&
    (current?.fingerprint === recordedFingerprint || current?.legacyFingerprint === recordedFingerprint)
}
