import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { open, readFile, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
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

export async function currentHostIdentity() {
  if (process.platform === 'linux') {
    try {
      const machineId = (await readFile('/etc/machine-id', 'utf8')).trim()
      if (machineId) {
        return 'linux:' + createHash('sha256').update(machineId).digest('hex').slice(0, 32)
      }
    } catch {
      // Hostname-only identity remains conservative when machine identity is unavailable.
    }
  }
  return process.platform + ':' + hostname()
}

async function psStartTime(pid) {
  if (process.platform === 'win32') {
    return null
  }
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (value) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolvePromise(value)
    }
    const child = spawn('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: { LANG: 'C', LC_ALL: 'C', PATH: '/usr/bin:/bin' },
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const chunks = []
    let bytes = 0
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes <= 4096) {
        chunks.push(chunk)
      }
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(null)
    }, 1000)
    child.once('error', () => finish(null))
    child.once('close', (code) => {
      const value = Buffer.concat(chunks).toString('utf8').trim().replace(/\s+/g, ' ')
      finish(code === 0 && value ? 'ps:' + value : null)
    })
  })
}

export async function processIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || !processIsAlive(pid)) {
    return null
  }
  if (process.platform === 'linux') {
    try {
      const [stat, bootId] = await Promise.all([
        readFile('/proc/' + pid + '/stat', 'utf8'),
        readFile('/proc/sys/kernel/random/boot_id', 'utf8')
      ])
      const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/)
      const startTicks = fields[19]
      if (startTicks && bootId.trim()) {
        return 'linux:' + bootId.trim() + ':' + startTicks
      }
    } catch {
      // Fall through to ps where available.
    }
  }
  return psStartTime(pid)
}

export async function createLockOwnerRecord(nonce, acquiredAt = new Date().toISOString()) {
  return {
    schemaVersion: 2,
    pid: process.pid,
    hostIdentity: await currentHostIdentity(),
    processIdentity: await processIdentity(process.pid),
    nonce,
    acquiredAt
  }
}

export async function lockOwnerIsDead(record) {
  if (!Number.isInteger(record?.pid) || record.pid <= 0) {
    return false
  }
  if (typeof record.hostIdentity === 'string' && record.hostIdentity && record.hostIdentity !== await currentHostIdentity()) {
    return false
  }
  if (!processIsAlive(record.pid)) {
    return true
  }
  if (typeof record.processIdentity !== 'string' || !record.processIdentity) {
    return false
  }
  const currentIdentity = await processIdentity(record.pid)
  return currentIdentity !== null && currentIdentity !== record.processIdentity
}

async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function recoverable(record, metadata, malformedStaleMs) {
  if (Number.isInteger(record?.pid) && record.pid > 0) {
    return lockOwnerIsDead(record)
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
  if (!await recoverable(first, metadata, malformedStaleMs)) {
    return false
  }
  const second = await readRecord(path)
  if ((first?.nonce ?? null) !== (second?.nonce ?? null) || !await recoverable(second, metadata, malformedStaleMs)) {
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
  const ownerRecord = await createLockOwnerRecord(nonce)
  let handle
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      handle = await open(guardPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(ownerRecord) + '\n')
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
