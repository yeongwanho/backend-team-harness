import { homedir } from 'node:os'
import { constants } from 'node:fs'
import { access, lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'

const BUILD_FILES = ['build.gradle', 'build.gradle.kts', 'pom.xml']

async function pathStat(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function hasGitAncestor(start) {
  let current = start
  while (true) {
    if (await pathStat(resolve(current, '.git'))) {
      return true
    }
    const parent = dirname(current)
    if (parent === current) {
      return false
    }
    current = parent
  }
}

async function hasBackendBuildFile(root) {
  for (const file of BUILD_FILES) {
    const stat = await pathStat(resolve(root, file))
    if (stat?.isFile() && !stat.isSymbolicLink()) {
      return true
    }
  }
  return false
}

export function assertRelativeChild(root, target) {
  const pathFromRoot = relative(root, target)
  if (pathFromRoot === '' || (!pathFromRoot.startsWith('..' + sep) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))) {
    return
  }
  throw new Error('Refusing to access a path outside the target project: ' + target)
}

export async function assertNoSymlinkSegments(root, target) {
  assertRelativeChild(root, target)
  const pathFromRoot = relative(root, target)
  if (!pathFromRoot) {
    return
  }

  let current = root
  for (const segment of pathFromRoot.split(sep)) {
    current = resolve(current, segment)
    const stat = await pathStat(current)
    if (!stat) {
      return
    }
    if (stat.isSymbolicLink()) {
      throw new Error('Refusing to follow a symbolic link inside the project: ' + current)
    }
  }
}

export async function resolveExistingProjectRoot(inputPath = '.', options = {}) {
  const requested = resolve(inputPath)
  const requestedStat = await pathStat(requested)
  if (!requestedStat) {
    throw new Error('Target project must already exist: ' + requested)
  }
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw new Error('Target project must be a real directory, not a file or symbolic link: ' + requested)
  }

  const root = await realpath(requested)
  if (root === parse(root).root) {
    throw new Error('Refusing to use the filesystem root as a project.')
  }

  let userHome = resolve(options.homeDirectory ?? homedir())
  try {
    userHome = await realpath(userHome)
  } catch {
    // A missing injected home is irrelevant to the project boundary.
  }
  if (root === userHome) {
    throw new Error('Refusing to use the user home directory as a project.')
  }

  if (!options.allowUnversioned && !await hasGitAncestor(root) && !await hasBackendBuildFile(root)) {
    throw new Error(
      'Target is neither inside a Git worktree nor a recognizable Gradle/Maven project. ' +
      'Pass --allow-unversioned only when this location is intentional.'
    )
  }

  return root
}

export async function resolveReadableRoot(inputPath = '.') {
  const requested = resolve(inputPath)
  await access(requested, constants.R_OK)
  const stat = await lstat(requested)
  if (!stat.isDirectory()) {
    throw new Error('Project path is not a directory: ' + requested)
  }
  return realpath(requested)
}

export async function resolveSafeProjectPath(root, relativePath) {
  if (isAbsolute(relativePath)) {
    throw new Error('Project-relative path required: ' + relativePath)
  }
  const target = resolve(root, relativePath)
  assertRelativeChild(root, target)
  await assertNoSymlinkSegments(root, target)
  return target
}

export async function statPath(path) {
  return pathStat(path)
}
