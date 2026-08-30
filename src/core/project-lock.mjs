import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertNoSymlinkSegments, resolveReadableRoot, resolveSafeProjectPath, statPath } from '../fs-safety.mjs'
import { createLockOwnerRecord, lockOwnerIsDead, withLockRecoveryGuard } from './lock-recovery.mjs'

async function readLock(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8'))
  } catch {
    return null
  }
}

async function recoverStaleLock(lockPath, staleMs) {
  return withLockRecoveryGuard(lockPath, { malformedStaleMs: Math.min(staleMs, 5000) }, async () => {
    const metadata = await statPath(lockPath)
    if (!metadata) {
      return true
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Project verification lock is not a regular file: ' + lockPath)
    }
    const record = await readLock(lockPath)
    const acquiredAt = Date.parse(record?.acquiredAt ?? '')
    const ageMs = Date.now() - (Number.isFinite(acquiredAt) ? acquiredAt : metadata.mtimeMs)
    const deadOwner = await lockOwnerIsDead(record)
    const malformedAndStale = !Number.isInteger(record?.pid) && ageMs >= Math.min(staleMs, 5000)
    if (deadOwner || malformedAndStale) {
      const current = await readLock(lockPath)
      if ((record?.nonce ?? null) !== (current?.nonce ?? null)) {
        return false
      }
      await unlink(lockPath)
      return true
    }
    return false
  })
}

export async function acquireProjectVerificationLock(inputPath, options = {}) {
  const root = await resolveReadableRoot(inputPath)
  const lockPath = await resolveSafeProjectPath(root, '.backend-harness/local/locks/project-verification.lock')
  await mkdir(dirname(lockPath), { recursive: true })
  await assertNoSymlinkSegments(root, lockPath)
  const timeoutMs = options.timeoutMs ?? 3000
  const staleMs = options.staleMs ?? 30 * 60 * 1000
  const retryMs = options.retryMs ?? 25
  const startedAt = Date.now()
  const nonce = randomUUID()
  const ownerRecord = await createLockOwnerRecord(nonce)

  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(ownerRecord) + '\n')
        await handle.sync()
      } catch (error) {
        await handle.close().catch(() => {})
        await unlink(lockPath).catch(() => {})
        throw error
      }
      return async () => {
        await handle.close()
        const current = await readLock(lockPath)
        if (current?.nonce !== nonce) {
          throw new Error('Project verification lock ownership changed before release.')
        }
        await unlink(lockPath).catch((error) => {
          if (error?.code !== 'ENOENT') {
            throw error
          }
        })
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      if (await recoverStaleLock(lockPath, staleMs)) {
        continue
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const locked = new Error('Another BTH verification is already running for this project.')
        locked.code = 'project_verification_locked'
        throw locked
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, retryMs))
    }
  }
}

export async function withProjectVerificationLock(inputPath, options, action) {
  const release = await acquireProjectVerificationLock(inputPath, options)
  try {
    return await action()
  } finally {
    await release()
  }
}
