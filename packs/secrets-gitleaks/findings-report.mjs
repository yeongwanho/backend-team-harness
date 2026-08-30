import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const MAX_FINDINGS_REPORT_BYTES = 16 * 1024 * 1024

export async function prepareProjectOutputDirectory(output) {
  const requestedRoot = resolve(process.cwd())
  const requestedDirectory = dirname(resolve(output))
  const projectRelative = relative(requestedRoot, requestedDirectory)
  if (projectRelative === '..' || projectRelative.startsWith('..' + sep) || isAbsolute(projectRelative)) {
    throw new Error('Gitleaks output directory must stay inside the project.')
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
      throw new Error('Gitleaks output directory must contain only regular project directories.')
    }
  }
  const resolvedDirectory = await realpath(directory)
  const resolvedRelative = relative(root, resolvedDirectory)
  if (resolvedRelative === '..' || resolvedRelative.startsWith('..' + sep) || isAbsolute(resolvedRelative)) {
    throw new Error('Gitleaks output directory must stay inside the project.')
  }
}

export async function writeFindingsReport(output, document) {
  await prepareProjectOutputDirectory(output)
  const text = JSON.stringify(document) + '\n'
  if (Buffer.byteLength(text) > MAX_FINDINGS_REPORT_BYTES) {
    throw new Error('Gitleaks findings report exceeds the 16 MiB safety limit.')
  }
  const temporary = resolve(dirname(output), '.bth-gitleaks-' + randomUUID() + '.tmp')
  await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    try {
      const current = await lstat(output)
      if (current.isSymbolicLink()) {
        await unlink(output)
      } else if (!current.isFile()) {
        throw new Error('Gitleaks output must be a regular file when it already exists.')
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
}
