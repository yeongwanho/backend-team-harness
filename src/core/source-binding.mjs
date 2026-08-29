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

async function hashFileEntry(gitRoot, path) {
  const target = resolve(gitRoot, path)
  ensureInside(gitRoot, target)
  const stat = await lstat(target)
  const contentHash = createHash('sha256')
  let kind
  if (stat.isSymbolicLink()) {
    kind = 'symlink'
    contentHash.update(await readlink(target))
  } else if (stat.isFile()) {
    kind = 'file'
    await new Promise((resolvePromise, reject) => {
      const stream = createReadStream(target)
      stream.on('data', (chunk) => contentHash.update(chunk))
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

async function hashDeclaredInput(gitRoot, projectRoot, path, options = {}) {
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
      return {
        pathSha256: sha256(relative(gitRoot, target).split(sep).join('/')),
        kind: 'symlink',
        contentSha256: sha256(await readlink(current))
      }
    }
  }
  return hashFileEntry(gitRoot, relative(gitRoot, target))
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
  const [status, trackedDiff, untrackedOutput] = await Promise.all([
    runGit(inputPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', ...pathspec]),
    runGit(inputPath, ['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', ...pathspec]),
    runGit(inputPath, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z', ...pathspec])
  ])

  const untrackedPaths = untrackedOutput
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort()
  const untracked = []
  for (const path of untrackedPaths) {
    untracked.push(await hashFileEntry(gitRoot, path))
  }

  const explicitInputs = []
  const explicitPaths = [...new Set(options.explicitPaths ?? [])].sort()
  const allowSymlinkPaths = new Set(options.allowSymlinkPaths ?? [])
  for (const path of explicitPaths) {
    try {
      explicitInputs.push(await hashDeclaredInput(gitRoot, resolvedInput, path, {
        allowSymlink: allowSymlinkPaths.has(path)
      }))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('Declared verification input is missing: ' + path)
      }
      throw error
    }
  }

  const input = {
    schemaVersion: 1,
    headCommit: headCommit.toLowerCase(),
    projectPath,
    clean: status.length === 0,
    changedEntryCount: status.toString('utf8').split('\0').filter(Boolean).length,
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    untracked,
    explicitInputs
  }
  return {
    ...input,
    fingerprint: sha256(canonicalJson(input))
  }
}
