import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sharedTemplates } from './templates.mjs'
import {
  assertNoSymlinkSegments,
  resolveExistingProjectRoot,
  resolveSafeProjectPath,
  statPath
} from './fs-safety.mjs'

function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

async function atomicReplace(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function initProject(inputPath = '.', options = {}) {
  const root = await resolveExistingProjectRoot(inputPath, {
    allowUnversioned: options.allowUnversioned,
    homeDirectory: options.homeDirectory
  })
  const harnessRoot = resolve(root, '.backend-harness')
  await assertNoSymlinkSegments(root, harnessRoot)

  const created = []
  const updated = []
  const skipped = []
  const backups = []
  const backupStamp = timestampForPath(options.now?.() ?? new Date()) + '-' + (options.backupSuffix ?? randomUUID().slice(0, 8))
  const writes = []

  for (const template of sharedTemplates) {
    const target = await resolveSafeProjectPath(root, template.path)
    const parent = dirname(target)
    await assertNoSymlinkSegments(root, parent)
    await assertNoSymlinkSegments(root, target)
    const existing = await statPath(target)

    if (existing?.isSymbolicLink()) {
      throw new Error('Refusing to replace a symbolic link: ' + target)
    }
    if (existing && !existing.isFile()) {
      throw new Error('Expected a regular file but found another filesystem entry: ' + target)
    }
    if (!options.force && existing) {
      skipped.push(template.path)
      continue
    }

    let backup = null
    if (existing) {
      const backupRelative = join(
        '.backend-harness/local/backups',
        backupStamp,
        relative('.backend-harness', template.path)
      )
      backup = await resolveSafeProjectPath(root, backupRelative)
    }
    writes.push({ template, target, parent, existing, backup })
  }

  for (const write of writes) {
    await mkdir(write.parent, { recursive: true })
    if (write.existing) {
      const backup = write.backup
      await mkdir(dirname(backup), { recursive: true })
      await writeFile(backup, await readFile(write.target), { flag: 'wx' })
      backups.push(relative(root, backup))
      await atomicReplace(write.target, write.template.content)
      updated.push(write.template.path)
    } else {
      await writeFile(write.target, write.template.content, { encoding: 'utf8', flag: 'wx' })
      created.push(write.template.path)
    }
  }

  return { root, created, updated, skipped, backups }
}
