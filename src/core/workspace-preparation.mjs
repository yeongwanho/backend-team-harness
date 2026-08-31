import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { buildSafeEnvironment, runProcess } from './process-runner.mjs'
import { preparePythonWorkspaceDependencies } from './python-workspace-preparation.mjs'

async function boundedJson(root, path) {
  const absolute = await resolveSafeProjectPath(root, path)
  const entry = await statPath(absolute)
  if (!entry?.isFile() || entry.isSymbolicLink()) throw new Error('Preparation metadata must be a regular file.')
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) throw new Error('Preparation metadata must be a regular file up to 8 MiB.')
    const buffer = Buffer.alloc(metadata.size + 1)
    let length = 0
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await handle.stat()
    if (length !== metadata.size || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) throw new Error('Preparation metadata changed during read.')
    let value
    try { value = JSON.parse(buffer.toString('utf8', 0, length)) } catch { throw new Error('Preparation metadata is not valid JSON.') }
    return { value, sha256: createHash('sha256').update(buffer.subarray(0, length)).digest('hex') }
  } finally { await handle.close() }
}

export function validateOfflineNpmLock(document, manifest) {
  if (!document || ![2, 3].includes(document.lockfileVersion) || !document.packages ||
      Array.isArray(document.packages) || typeof document.packages !== 'object' || !document.packages[''] ||
      !manifest || typeof manifest !== 'object' || Array.isArray(manifest) || manifest.workspaces || document.packages[''].workspaces) {
    throw new Error('Offline preparation supports standalone npm lockfile v2/v3 projects, not workspaces.')
  }
  const registrySpec = value => typeof value === 'string' && value.length <= 4096 &&
    (/^[A-Za-z0-9*~^<>=|. +_-]+$/.test(value) || /^npm:(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+@[A-Za-z0-9*~^<>=|. +_-]+$/.test(value))
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.values(manifest[key] ?? {}).some(value => !registrySpec(value))) throw new Error('Preparation rejects non-registry dependency specifications.')
  }
  if (manifest.overrides || manifest.bundleDependencies || manifest.bundledDependencies) throw new Error('Preparation does not infer override or bundled dependency semantics.')
  const packages = Object.entries(document.packages)
  if (packages.length > 20000) throw new Error('Preparation lockfile exceeds 20000 entries.')
  let legacyIntegrityEntries = 0
  for (const [path, entry] of packages) {
    if (!path) continue
    if (!path.startsWith('node_modules/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') ||
        !entry || typeof entry !== 'object' || entry.link || typeof entry.resolved !== 'string') {
      throw new Error('Offline preparation rejects local, linked, bundled, or unsupported dependency entries.')
    }
    let url
    try { url = new URL(entry.resolved) } catch { throw new Error('Dependency URL is invalid.') }
    if (url.protocol !== 'https:' || url.username || url.password ||
        typeof entry.integrity !== 'string' || !/^(?:sha1|sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)) {
      throw new Error('Offline preparation requires HTTPS tarball dependencies with pinned SRI integrity.')
    }
    if (entry.integrity.startsWith('sha1-')) legacyIntegrityEntries++
  }
  return { dependencyEntries: packages.length - 1, legacyIntegrityEntries }
}

export async function prepareWorkspaceDependencies(sourceRoot, workspaceRoot, configuration, declaredInputs, options = {}) {
  if (!configuration) return null
  const [source, workspace] = await Promise.all([realpath(sourceRoot), realpath(workspaceRoot)])
  const direction = relative(source, workspace)
  const reverse = relative(workspace, source)
  const outside = value => isAbsolute(value) || value === '..' || value.startsWith('../') || value.startsWith('..\\')
  if (!outside(direction) || !outside(reverse)) throw new Error('Dependencies may only be prepared in a separate implementation workspace.')
  if (configuration.kind === 'uv-sync-offline') return preparePythonWorkspaceDependencies(workspace, configuration, declaredInputs, options)
  if (configuration.kind !== 'npm-ci-offline') throw new Error('Unsupported workspace preparation kind.')
  const prefix = configuration.projectPath === '.' ? '' : configuration.projectPath + '/'
  const paths = [prefix + 'package.json', prefix + 'package-lock.json']
  if (paths.some(path => !declaredInputs.map(value => value.replace(/^\.\//, '')).includes(path))) {
    throw new Error('Preparation package and lockfile must be declared verification inputs.')
  }
  const inputs = await Promise.all(paths.map(path => boundedJson(workspace, path)))
  const counts = validateOfflineNpmLock(inputs[1].value, inputs[0].value)
  const project = prefix ? await resolveSafeProjectPath(workspace, configuration.projectPath) : workspace
  if (await statPath(await resolveSafeProjectPath(project, 'npm-shrinkwrap.json'))) throw new Error('Preparation cannot let npm-shrinkwrap override the declared package lock.')
  const dependencies = await resolveSafeProjectPath(project, 'node_modules')
  const metadata = await statPath(dependencies)
  if (metadata && (!metadata.isDirectory() || metadata.isSymbolicLink())) throw new Error('Workspace node_modules must not be a link or non-directory.')
  const invocation = {
    program: (options.platform ?? process.platform) === 'win32' ? 'npm.cmd' : 'npm',
    args: ['--prefix', project, '--global=false', '--workspaces=false', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    cwd: resolve(project), timeoutMs: configuration.timeoutMs, env: buildSafeEnvironment()
  }
  const execution = await (options.processRunner ?? runProcess)(invocation)
  const passed = execution.exitCode === 0 && !execution.signal && !execution.timedOut && !execution.stdioDrainTimedOut
  return {
    kind: configuration.kind, projectPath: configuration.projectPath, status: passed ? 'passed' : 'failed',
    ...counts, inputs: paths.map((path, index) => ({ path, sha256: inputs[index].sha256 })),
    command: [invocation.program, '--prefix', '<isolated-project>', ...invocation.args.slice(2)],
    failureCode: passed ? null : /ENOTCACHED|cache mode is 'only-if-cached'|not in cache/i.test(execution.stderr?.tail ?? '')
      ? 'offline-dependency-cache-incomplete' : 'workspace-preparation-failed',
    process: {
      exitCode: execution.exitCode, signal: execution.signal, timedOut: execution.timedOut,
      stdioDrainTimedOut: execution.stdioDrainTimedOut, durationMs: execution.durationMs,
      stdout: { sha256: execution.stdout?.sha256, bytes: execution.stdout?.bytes },
      stderr: { sha256: execution.stderr?.sha256, bytes: execution.stderr?.bytes }
    },
    lifecycleScripts: false, onlineFallback: false, egressIsolation: 'not-enforced'
  }
}
