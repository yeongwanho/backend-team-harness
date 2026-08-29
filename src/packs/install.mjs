import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadVerificationConfig, parseVerificationConfig } from '../config/verification.mjs'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { gateForPack, getPack } from './catalog.mjs'
import { withProjectVerificationLock } from '../core/project-lock.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

async function atomicReplace(target, content) {
  const temporary = resolve(dirname(target), '.bth-' + randomUUID() + '.tmp')
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try {
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function installPackUnlocked(inputPath, packId) {
  const pack = getPack(packId)
  if (!pack) {
    throw new Error('Unknown pack: ' + packId)
  }
  const root = await resolveReadableRoot(inputPath)
  const loaded = await loadVerificationConfig(root, { allowInferred: false })
  if (loaded.source !== '.backend-harness/verification.json') {
    throw new Error('Pack installation requires a shared .backend-harness/verification.json file.')
  }
  const gate = await gateForPack(pack, root)
  if (loaded.config.gates.some((entry) => entry.id === gate.id)) {
    throw new Error('Verification gate already exists: ' + gate.id)
  }
  const destination = await resolveSafeProjectPath(root, '.backend-harness/packs/' + pack.id)
  if (await statPath(destination)) {
    throw new Error('Pack directory already exists: .backend-harness/packs/' + pack.id)
  }
  const stagingRoot = await resolveSafeProjectPath(root, '.backend-harness/local/staging')
  await mkdir(stagingRoot, { recursive: true })
  const staging = resolve(stagingRoot, 'pack-' + pack.id + '-' + randomUUID())
  await mkdir(staging)
  try {
    for (const name of pack.files) {
      const source = resolve(packageRoot, 'packs', pack.id, name)
      const target = resolve(staging, name)
      await assertNoSymlinkSegments(staging, target)
      await writeFile(target, await readFile(source), { flag: 'wx', mode: name === 'run' ? 0o755 : 0o600 })
      if (name === 'run' && process.platform !== 'win32') {
        await chmod(target, 0o755)
      }
    }
    const normalized = parseVerificationConfig(JSON.stringify({
      ...loaded.config,
      gates: pack.id === 'secrets-gitleaks'
        ? [gate, ...loaded.config.gates]
        : [...loaded.config.gates, gate]
    }), 'pack:' + pack.id)
    const configPath = await resolveSafeProjectPath(root, '.backend-harness/verification.json')
    const backupDir = await resolveSafeProjectPath(root, '.backend-harness/local/backups/packs')
    await mkdir(backupDir, { recursive: true })
    const backup = resolve(backupDir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + pack.id + '-verification.json')
    await writeFile(backup, await readFile(configPath), { flag: 'wx', mode: 0o600 })
    await mkdir(dirname(destination), { recursive: true })
    await rename(staging, destination)
    try {
      await atomicReplace(configPath, JSON.stringify(normalized, null, 2) + '\n')
    } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    return {
      root,
      pack: { id: pack.id, title: pack.title, evidenceTier: pack.evidenceTier },
      gate,
      path: '.backend-harness/packs/' + pack.id,
      backup: backup.slice(root.length + 1)
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export function installPack(inputPath, packId) {
  return withProjectVerificationLock(inputPath, undefined, () => installPackUnlocked(inputPath, packId))
}
