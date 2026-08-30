import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'

const SAFE_ENVIRONMENT_KEYS = [
  'HOME',
  'DOCKER_CERT_PATH',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'GRADLE_USER_HOME',
  'JAVA_HOME',
  'LANG',
  'LC_ALL',
  'M2_HOME',
  'ComSpec',
  'COMSPEC',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE',
  'TESTCONTAINERS_HOST_OVERRIDE',
  'TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX',
  'TMPDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
  'XDG_RUNTIME_DIR',
  'http_proxy',
  'https_proxy',
  'no_proxy'
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

function quoteWindowsBatchToken(value, label) {
  if (typeof value !== 'string' || /[\0\r\n"%]/.test(value)) {
    throw new Error(label + ' cannot be represented safely by cmd.exe.')
  }
  return '"' + value + '"'
}

export function buildProcessLaunch({ program, args = [], platform = process.platform, env = process.env }) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(program)) {
    return {
      program,
      args,
      options: { detached: platform !== 'win32', shell: false, windowsHide: platform === 'win32' }
    }
  }
  const shell = env.ComSpec || env.COMSPEC || (env.SystemRoot ? env.SystemRoot + '\\System32\\cmd.exe' : 'cmd.exe')
  const command = [
    quoteWindowsBatchToken(program, 'Windows batch executable'),
    ...args.map((argument, index) => quoteWindowsBatchToken(argument, 'Windows batch argument ' + index))
  ].join(' ')
  return {
    program: shell,
    args: ['/d', '/s', '/c', '"' + command + '"'],
    options: {
      detached: false,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true
    }
  }
}

export function windowsTaskkillInvocation(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Windows process-tree termination requires a positive PID.')
  return {
    program: 'taskkill.exe',
    args: ['/pid', String(pid), '/t', ...(signal === 'SIGKILL' ? ['/f'] : [])]
  }
}

export function runProcess({
  program,
  args,
  cwd,
  timeoutMs = 10 * 60 * 1000,
  stdioDrainTimeoutMs = 250,
  stdioTerminateGraceMs = 250,
  stdioKillWaitMs = 250,
  env
}) {
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
    let stdioDrainTimedOut = false
    let settled = false
    let forceKillTimeout = null
    let stdioDrainTimeout = null
    let observedExitCode = null
    let observedSignal = null
    let drainCleanupPending = false

    const childEnvironment = env ?? buildSafeEnvironment()
    const launch = buildProcessLaunch({ program, args, env: childEnvironment })
    const child = spawn(launch.program, launch.args, {
      cwd,
      env: childEnvironment,
      ...launch.options,
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
      if (process.platform === 'win32' && child.pid) {
        const termination = windowsTaskkillInvocation(child.pid, signal)
        const killer = spawn(termination.program, termination.args, {
          env: childEnvironment,
          shell: false,
          windowsHide: true,
          stdio: 'ignore'
        })
        let fallbackRequested = false
        const fallback = () => {
          if (fallbackRequested) return
          fallbackRequested = true
          child.kill(signal)
        }
        killer.once('error', fallback)
        killer.once('close', (code) => {
          if (code !== 0) fallback()
        })
        return
      }
      child.kill(signal)
    }

    const processGroupIsAlive = () => {
      if (process.platform === 'win32' || !child.pid) {
        return false
      }
      try {
        process.kill(-child.pid, 0)
        return true
      } catch (error) {
        return error?.code === 'EPERM'
      }
    }

    const waitForProcessGroupExit = async (maximumMs) => {
      const deadline = Date.now() + maximumMs
      while (processGroupIsAlive() && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(25, Math.max(1, deadline - Date.now()))))
      }
      return !processGroupIsAlive()
    }

    const onStdout = (chunk) => {
      if (settled) {
        return
      }
      stdoutHash.update(chunk)
      stdoutBytes += chunk.length
      stdoutTail = Buffer.concat([stdoutTail, chunk]).subarray(-8192)
    }
    const onStderr = (chunk) => {
      if (settled) {
        return
      }
      stderrHash.update(chunk)
      stderrBytes += chunk.length
      stderrTail = Buffer.concat([stderrTail, chunk]).subarray(-8192)
    }
    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)

    const timeout = setTimeout(() => {
      timedOut = true
      killProcessTree('SIGTERM')
      forceKillTimeout = setTimeout(() => killProcessTree('SIGKILL'), 2000)
    }, timeoutMs)

    const finish = (exitCode, signal) => {
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      clearTimeout(stdioDrainTimeout)
      if (settled) {
        return
      }
      settled = true
      const finishedAt = new Date()
      resolvePromise({
        exitCode,
        signal,
        timedOut,
        stdioDrainTimedOut,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Date.now() - startedMonotonic,
        stdout: { sha256: stdoutHash.digest('hex'), bytes: stdoutBytes, tail: stdoutTail.toString('utf8') },
        stderr: { sha256: stderrHash.digest('hex'), bytes: stderrBytes, tail: stderrTail.toString('utf8') }
      })
    }

    child.once('error', (error) => {
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      clearTimeout(stdioDrainTimeout)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.once('exit', (exitCode, signal) => {
      observedExitCode = exitCode
      observedSignal = signal
      clearTimeout(timeout)
      stdioDrainTimeout = setTimeout(() => {
        stdioDrainTimedOut = true
        drainCleanupPending = true
        void (async () => {
          try {
            killProcessTree('SIGTERM')
            const terminated = await waitForProcessGroupExit(stdioTerminateGraceMs)
            if (!terminated) {
              killProcessTree('SIGKILL')
              await waitForProcessGroupExit(stdioKillWaitMs)
            }
          } finally {
            child.stdout.off('data', onStdout)
            child.stderr.off('data', onStderr)
            try {
              child.stdout.destroy()
            } catch {
              // The Gate is already failed as a drain timeout; completion must still settle.
            }
            try {
              child.stderr.destroy()
            } catch {
              // The Gate is already failed as a drain timeout; completion must still settle.
            }
            drainCleanupPending = false
            finish(observedExitCode, observedSignal)
          }
        })().catch(() => {})
      }, stdioDrainTimeoutMs)
    })
    child.once('close', (exitCode, signal) => {
      if (drainCleanupPending) {
        return
      }
      finish(exitCode ?? observedExitCode, signal ?? observedSignal)
    })
  })
}
