import { readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export const PROJECT_MANIFEST = Symbol('backend-team-harness.project-manifest')

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.backend-harness',
  'build',
  'node_modules',
  'out',
  'target'
])

function portable(path) {
  return path.split(sep).join('/')
}

function positiveLimit(value, fallback, label, allowInfinity = false) {
  const resolved = value ?? fallback
  if (allowInfinity && resolved === Infinity) {
    return resolved
  }
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw new Error(label + ' must be a non-negative safe integer.')
  }
  return resolved
}

export function manifestJvmPaths(manifest) {
  return manifest.files.filter((path) => /\.(?:java|kt)$/.test(path))
}

export async function scanProjectManifest(root, options = {}) {
  const maxDepth = positiveLimit(options.maxDepth, 12, 'Project manifest maxDepth', true)
  const maxEntries = positiveLimit(options.maxEntries, 10_000, 'Project manifest maxEntries')
  const onLimit = options.onLimit ?? 'truncate'
  const onReadError = options.onReadError ?? 'ignore'
  if (!['truncate', 'throw'].includes(onLimit)) {
    throw new Error('Project manifest onLimit must be truncate or throw.')
  }
  if (!['ignore', 'throw'].includes(onReadError)) {
    throw new Error('Project manifest onReadError must be ignore or throw.')
  }

  const files = []
  let visitedEntries = 0
  let skippedSymlinks = 0
  let skippedJvmSymlinks = 0
  let unreadableDirectories = 0
  let truncated = false

  function limitReached() {
    if (onLimit === 'throw') {
      throw new Error('Project manifest exceeded the ' + maxEntries + '-entry safety limit.')
    }
    truncated = true
    return true
  }

  async function visit(directory, depth) {
    if (depth > maxDepth || truncated) {
      return
    }
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (onReadError === 'throw') {
        throw error
      }
      unreadableDirectories += 1
      return
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)

    for (const entry of entries) {
      if (visitedEntries >= maxEntries) {
        limitReached()
        return
      }
      visitedEntries += 1
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        skippedSymlinks += 1
        const sourceLink = /\.(?:java|kt)$/.test(entry.name)
        let directoryLink = false
        if (!sourceLink) {
          try {
            directoryLink = (await stat(path)).isDirectory()
          } catch {
            // Broken or inaccessible links remain skipped without being followed.
          }
        }
        if (sourceLink || directoryLink) {
          skippedJvmSymlinks += 1
        }
        continue
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(path, depth + 1)
        }
      } else if (entry.isFile()) {
        files.push(portable(relative(root, path)))
      }
    }
  }

  await visit(root, 0)
  files.sort()
  return {
    schemaVersion: 1,
    root,
    files,
    visitedEntries,
    skippedSymlinks,
    skippedJvmSymlinks,
    unreadableDirectories,
    truncated,
    limits: { maxDepth, maxEntries }
  }
}
