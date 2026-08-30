import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { resolveExistingProjectRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { bthError } from '../core/errors.mjs'
import { parseImplementationConfig } from './implementation.mjs'

function timestamp(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

async function atomicWrite(path, content) {
  const temporary = resolve(dirname(path), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function migrateProjectConfig(inputPath, options = {}) {
  const root = await resolveExistingProjectRoot(inputPath)
  const target = await resolveSafeProjectPath(root, '.backend-harness/implementation.json')
  const metadata = await statPath(target)
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) {
    throw bthError('config_migration_source_invalid', 'Implementation config is missing, unsafe, or exceeds 1 MiB.')
  }
  const previousText = await readFile(target, 'utf8')
  const previous = parseImplementationConfig(previousText, '.backend-harness/implementation.json')
  if (previous.schemaVersion === 2) {
    return { root, changed: false, from: 2, to: 2, backup: null, config: previous }
  }
  if (options.allowWrite !== true) {
    throw bthError('config_migration_write_required', 'Config migration requires --allow-write after reviewing the v1 to v2 change.')
  }
  const raw = JSON.parse(previousText)
  const next = {
    ...raw,
    schemaVersion: 2,
    adapter: raw.adapter === null ? null : { kind: 'command', ...raw.adapter }
  }
  const content = JSON.stringify(next, null, 2) + '\n'
  const normalized = parseImplementationConfig(content, '.backend-harness/implementation.json')
  const backup = await resolveSafeProjectPath(
    root,
    '.backend-harness/local/backups/implementation-schema-v1-' + timestamp(options.now?.() ?? new Date()) + '-' + (options.backupSuffix ?? randomUUID().slice(0, 8)) + '.json'
  )
  await mkdir(dirname(backup), { recursive: true })
  await writeFile(backup, previousText, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  await atomicWrite(target, content)
  return {
    root,
    changed: true,
    from: 1,
    to: 2,
    backup: relative(root, backup).replaceAll('\\', '/'),
    config: normalized
  }
}
