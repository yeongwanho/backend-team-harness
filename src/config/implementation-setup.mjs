import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { resolveExistingProjectRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { parseImplementationConfig } from './implementation.mjs'

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

async function atomicWrite(path, content) {
  const temporary = resolve(dirname(path), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function configureImplementationProvider(inputPath, provider, options = {}) {
  const root = await resolveExistingProjectRoot(inputPath)
  const target = await resolveSafeProjectPath(root, '.backend-harness/implementation.json')
  const metadata = await statPath(target)
  if (metadata?.isSymbolicLink() || (metadata && !metadata.isFile())) {
    throw new Error('Implementation config must be a regular non-symbolic-link file.')
  }
  let previousText = null
  let previous = null
  if (metadata) {
    if (metadata.size > 1024 * 1024) throw new Error('Implementation config exceeds 1 MiB.')
    previousText = await readFile(target, 'utf8')
    try {
      previous = parseImplementationConfig(previousText, '.backend-harness/implementation.json')
    } catch (error) {
      if (options.force !== true) throw error
    }
    if (previous?.adapter && options.force !== true) {
      throw new Error('Implementation adapter is already configured. Re-run with --force to replace it and create a backup.')
    }
  }
  const allowedPrefixes = options.allowedPrefixes ?? previous?.writePolicy?.allowedPrefixes ?? ['src/']
  const document = {
    schemaVersion: 2,
    adapter: {
      kind: 'provider', provider, network: true,
      timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
      model: options.model ?? null,
      mode: options.mode ?? 'auto',
      contextBudgetCharacters: options.contextBudgetCharacters ?? null,
      maxBudgetUsd: options.maxBudgetUsd ?? null
    },
    writePolicy: {
      allowedPrefixes,
      maxChangedFiles: options.maxChangedFiles ?? previous?.writePolicy?.maxChangedFiles ?? 100,
      maxDiffBytes: options.maxDiffBytes ?? previous?.writePolicy?.maxDiffBytes ?? 2 * 1024 * 1024
    },
    recovery: { maxAttempts: options.maxAttempts ?? previous?.recovery?.maxAttempts ?? 2 }
  }
  const content = JSON.stringify(document, null, 2) + '\n'
  const normalized = parseImplementationConfig(content, '.backend-harness/implementation.json')
  let backup = null
  if (previousText !== null) {
    backup = await resolveSafeProjectPath(
      root,
      '.backend-harness/local/backups/implementation-' + timestamp(options.now?.() ?? new Date()) + '-' + (options.backupSuffix ?? randomUUID().slice(0, 8)) + '.json'
    )
    await mkdir(dirname(backup), { recursive: true })
    await writeFile(backup, previousText, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  }
  await mkdir(dirname(target), { recursive: true })
  await atomicWrite(target, content)
  return {
    root,
    path: relative(root, target).replaceAll('\\', '/'),
    backup: backup ? relative(root, backup).replaceAll('\\', '/') : null,
    config: normalized
  }
}
