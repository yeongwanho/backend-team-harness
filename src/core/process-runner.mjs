import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const SAFE_ENVIRONMENT_KEYS = [
  'HOME',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  'M2_HOME',
  'PATH',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP'
]

export function buildSafeEnvironment(source = process.env) {
  const result = { BTH_NODE: process.execPath, CI: 'true', TERM: 'dumb' }
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (typeof source[key] === 'string') {
      result[key] = source[key]
    }
  }
  return result
}

export function runProcess({ program, args, cwd, timeoutMs = 10 * 60 * 1000, env }) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = new Date()
    const startedMonotonic = Date.now()
    const stdoutHash = createHash('sha256')
    const stderrHash = createHash('sha256')
    let stdoutBytes = 0
    let stderrBytes = 0
    let stdoutTail = Buffer.alloc(0)
    let stderrTail = Buffer.alloc(0)
    let timedOut = false
    let settled = false
    let forceKillTimeout = null

    const child = spawn(program, args, {
      cwd,
      env: env ?? buildSafeEnvironment(),
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const killProcessTree = (signal) => {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch (error) {
          if (error?.code !== 'ESRCH') {
            child.kill(signal)
          }
          return
        }
      }
      child.kill(signal)
    }

    child.stdout.on('data', (chunk) => {
      stdoutHash.update(chunk)
      stdoutBytes += chunk.length
      stdoutTail = Buffer.concat([stdoutTail, chunk]).subarray(-8192)
    })
    child.stderr.on('data', (chunk) => {
      stderrHash.update(chunk)
      stderrBytes += chunk.length
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-8192)
    })

    const timeout = setTimeout(() => {
      timedOut = true
      killProcessTree('SIGTERM')
      forceKillTimeout = setTimeout(() => killProcessTree('SIGKILL'), 2000)
    }, timeoutMs)

    child.once('error', (error) => {
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      if (settled) {
        return
      }
      settled = true
      const finishedAt = new Date()
      resolvePromise({
        exitCode,
        signal,
        timedOut,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Date.now() - startedMonotonic,
        stdout: { sha256: stdoutHash.digest('hex'), bytes: stdoutBytes, tail: stdoutTail.toString('utf8') },
        stderr: { sha256: stderrHash.digest('hex'), bytes: stderrBytes, tail: stderrTail.toString('utf8') }
      })
    })
  })
}
