import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const MAX_GRAPH_REPORT_BYTES = 16 * 1024 * 1024

export function serializeGraphReport(document, options = {}) {
  const maximumBytes = options.maximumBytes ?? MAX_GRAPH_REPORT_BYTES
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_GRAPH_REPORT_BYTES) {
    throw new Error('Graph report byte limit must be between 1 and ' + MAX_GRAPH_REPORT_BYTES + '.')
  }
  const text = JSON.stringify(document) + '\n'
  const bytes = Buffer.byteLength(text)
  if (bytes > maximumBytes) {
    throw new Error('Codegraph report exceeds the ' + maximumBytes + '-byte safety limit.')
  }
  return { text, bytes }
}

export async function prepareProjectOutputDirectory(output) {
  const requestedRoot = resolve(process.cwd())
  const requestedDirectory = dirname(resolve(output))
  const projectRelative = relative(requestedRoot, requestedDirectory)
  if (projectRelative === '..' || projectRelative.startsWith('..' + sep) || isAbsolute(projectRelative)) {
    throw new Error('Codegraph output directory must stay inside the project.')
  }
  const root = await realpath(requestedRoot)
  let directory = root
  for (const segment of projectRelative.split(sep).filter(Boolean)) {
    directory = resolve(directory, segment)
    let metadata
    try {
      metadata = await lstat(directory)
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      try {
        await mkdir(directory, { mode: 0o700 })
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') {
          throw mkdirError
        }
      }
      metadata = await lstat(directory)
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Codegraph output directory must contain only regular project directories.')
    }
  }
  const resolvedDirectory = await realpath(directory)
  const resolvedRelative = relative(root, resolvedDirectory)
  if (resolvedRelative === '..' || resolvedRelative.startsWith('..' + sep) || isAbsolute(resolvedRelative)) {
    throw new Error('Codegraph output directory must stay inside the project.')
  }
}

export async function writeGraphReport(output, document, options = {}) {
  const { text, bytes } = serializeGraphReport(document, options)
  await prepareProjectOutputDirectory(output)
  const temporary = resolve(dirname(output), '.bth-codegraph-' + randomUUID() + '.tmp')
  await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    try {
      const current = await lstat(output)
      if (current.isSymbolicLink()) {
        await unlink(output)
      } else if (!current.isFile()) {
        throw new Error('Codegraph output must be a regular file when it already exists.')
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    await rename(temporary, output)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return bytes
}
