import { randomUUID } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'
import { statPath } from '../fs-safety.mjs'

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function recoverable(record, metadata, malformedStaleMs) {
  if (Number.isInteger(record?.pid) && record.pid > 0) {
    return !processIsAlive(record.pid)
  }
  return Date.now() - metadata.mtimeMs >= malformedStaleMs
}

async function removeOrphanGuard(path, malformedStaleMs) {
  const metadata = await statPath(path)
  if (!metadata) {
    return true
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Lock recovery guard is not a regular file: ' + path)
  }
  const first = await readRecord(path)
  if (!recoverable(first, metadata, malformedStaleMs)) {
    return false
  }
  const second = await readRecord(path)
  if ((first?.nonce ?? null) !== (second?.nonce ?? null) || !recoverable(second, metadata, malformedStaleMs)) {
    return false
  }
  await unlink(path).catch((error) => {
    if (error?.code !== 'ENOENT') {
      throw error
    }
  })
  return true
}

export async function withLockRecoveryGuard(lockPath, options, action) {
  const guardPath = lockPath + '.recovering'
  const malformedStaleMs = options?.malformedStaleMs ?? 5000
  const nonce = randomUUID()
  let handle
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      handle = await open(guardPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({
          schemaVersion: 1,
          pid: process.pid,
          nonce,
          acquiredAt: new Date().toISOString()
        }) + '\n')
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => {})
        handle = null
        await unlink(guardPath).catch(() => {})
        throw error
      }
      break
    } catch (error) {
      await handle?.close().catch(() => {})
      handle = null
      if (error?.code !== 'EEXIST') {
        throw error
      }
      if (!await removeOrphanGuard(guardPath, malformedStaleMs)) {
        return false
      }
    }
  }
  if (!handle) {
    return false
  }
  try {
    const current = await readRecord(guardPath)
    if (current?.nonce !== nonce) {
      return false
    }
    return await action()
  } finally {
    await handle.close().catch(() => {})
    const current = await readRecord(guardPath)
    if (current?.nonce === nonce) {
      await unlink(guardPath).catch(() => {})
    }
  }
}
