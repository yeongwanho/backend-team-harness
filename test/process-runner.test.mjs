import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'

test('child-process environment excludes unrelated credentials', () => {
  const environment = buildSafeEnvironment({
    PATH: '/usr/bin',
    HOME: '/tmp/example-home',
    USER: 'example-user',
    LOGNAME: 'example-user',
    CODEX_HOME: '/tmp/codex-home',
    CLAUDE_CONFIG_DIR: '/tmp/claude-config',
    APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local',
    XDG_CONFIG_HOME: '/tmp/xdg-config',
    MAVEN_OPTS: '-javaagent:/tmp/untrusted.jar',
    AWS_SECRET_ACCESS_KEY: 'must-not-pass',
    DATABASE_URL: 'must-not-pass'
  })

  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.HOME, '/tmp/example-home')
  assert.equal(environment.USER, 'example-user')
  assert.equal(environment.LOGNAME, 'example-user')
  assert.equal(environment.CODEX_HOME, '/tmp/codex-home')
  assert.equal(environment.CLAUDE_CONFIG_DIR, '/tmp/claude-config')
  assert.equal(environment.APPDATA, 'C:\\Users\\example\\AppData\\Roaming')
  assert.equal(environment.LOCALAPPDATA, 'C:\\Users\\example\\AppData\\Local')
  assert.equal(environment.XDG_CONFIG_HOME, '/tmp/xdg-config')
  assert.equal(environment.CI, 'true')
  assert.equal(environment.BTH_NODE, process.execPath)
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(environment.DATABASE_URL, undefined)
  assert.equal(environment.MAVEN_OPTS, undefined)
})

test('child-process environment keeps narrow Docker and Testcontainers routing without credentials', () => {
  const environment = buildSafeEnvironment({
    PATH: '/usr/bin',
    DOCKER_HOST: 'unix:///tmp/colima.sock',
    TESTCONTAINERS_HOST_OVERRIDE: '127.0.0.1',
    TESTCONTAINERS_RYUK_DISABLED: 'true',
    TESTCONTAINERS_REUSE_ENABLE: 'true',
    TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX: 'mirror.example/',
    DOCKER_CONTEXT: 'colima',
    HTTPS_PROXY: 'http://proxy.example:8080',
    NO_PROXY: 'localhost,127.0.0.1',
    XDG_RUNTIME_DIR: '/tmp/runtime',
    GRADLE_USER_HOME: '/tmp/gradle-cache',
    DOCKER_AUTH_CONFIG: 'must-not-pass'
  })

  assert.equal(environment.DOCKER_HOST, 'unix:///tmp/colima.sock')
  assert.equal(environment.TESTCONTAINERS_HOST_OVERRIDE, '127.0.0.1')
  assert.equal(environment.TESTCONTAINERS_RYUK_DISABLED, undefined)
  assert.equal(environment.TESTCONTAINERS_REUSE_ENABLE, undefined)
  assert.equal(environment.TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX, 'mirror.example/')
  assert.equal(environment.DOCKER_CONTEXT, 'colima')
  assert.equal(environment.HTTPS_PROXY, 'http://proxy.example:8080')
  assert.equal(environment.NO_PROXY, 'localhost,127.0.0.1')
  assert.equal(environment.XDG_RUNTIME_DIR, '/tmp/runtime')
  assert.equal(environment.GRADLE_USER_HOME, '/tmp/gradle-cache')
  assert.equal(environment.DOCKER_AUTH_CONFIG, undefined)
})

test('stdout line observation is bounded and does not retain raw lines in process evidence', async () => {
  const observed = []
  const result = await runProcess({
    program: process.execPath,
    args: ['-e', 'process.stdout.write("one\\ntwo")'],
    cwd: process.cwd(),
    timeoutMs: 1000,
    onStdoutLine: (line) => observed.push(line),
    env: buildSafeEnvironment(process.env)
  })

  assert.deepEqual(observed, ['one', 'two'])
  assert.deepEqual(result.stdout.observation, { lines: 2, droppedLines: 0, observerErrors: 0 })
  assert.equal('observedLines' in result.stdout, false)
})

test('stdio-drain cleanup ignores queued descendant output after finalizing hashes', { skip: process.platform === 'win32' }, async () => {
  const grandchild = [
    'process.on("SIGTERM", () => {})',
    'process.stdout.write("late-output\\n", () => process.send("ready"))',
    'setInterval(() => process.stdout.write("late-output\\n"), 1)'
  ].join(';')
  const parent = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", ' + JSON.stringify(grandchild) + '], { stdio: ["ignore", "inherit", "inherit", "ipc"] })',
    'child.once("message", () => { child.disconnect(); child.unref() })'
  ].join(';')

  const result = await runProcess({
    program: process.execPath,
    args: ['-e', parent],
    cwd: process.cwd(),
    timeoutMs: 2000,
    stdioDrainTimeoutMs: 30,
    stdioTerminateGraceMs: 30,
    stdioKillWaitMs: 100,
    env: buildSafeEnvironment(process.env)
  })

  assert.equal(result.stdioDrainTimedOut, true)
  assert.ok(result.stdout.bytes > 0)
  assert.match(result.stdout.tail, /late-output/)
  assert.match(result.stdout.sha256, /^[a-f0-9]{64}$/)
})

test('timed-out processes cannot produce confirmed evidence', async () => {
  const result = await runProcess({
    program: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    timeoutMs: 20,
    env: buildSafeEnvironment(process.env)
  })

  assert.equal(result.timedOut, true)
  assert.notEqual(result.signal, null)
})

test('timeout terminates descendants in the spawned process group', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-process-tree-'))
  const marker = join(root, 'grandchild-survived.txt')
  const grandchild = 'setTimeout(() => require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "alive"), 250)'
  const parent = [
    'const { spawn } = require("node:child_process")',
    'spawn(process.execPath, ["-e", ' + JSON.stringify(grandchild) + '], { stdio: "ignore" })',
    'setInterval(() => {}, 1000)'
  ].join(';')

  const result = await runProcess({
    program: process.execPath,
    args: ['-e', parent],
    cwd: root,
    timeoutMs: 30,
    env: buildSafeEnvironment(process.env)
  })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 350))

  assert.equal(result.timedOut, true)
  await assert.rejects(readFile(marker, 'utf8'), (error) => error.code === 'ENOENT')
})

test('a successful parent with leaked descendant stdio is not misreported as a command timeout', { skip: process.platform === 'win32' }, async () => {
  const grandchild = 'setInterval(() => {}, 1000)'
  const parent = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", ' + JSON.stringify(grandchild) + '], { stdio: ["ignore", "inherit", "inherit"] })',
    'child.unref()'
  ].join(';')

  const result = await runProcess({
    program: process.execPath,
    args: ['-e', parent],
    cwd: process.cwd(),
    timeoutMs: 1000,
    stdioDrainTimeoutMs: 50,
    env: buildSafeEnvironment(process.env)
  })

  assert.equal(result.exitCode, 0)
  assert.equal(result.timedOut, false)
  assert.equal(result.stdioDrainTimedOut, true)
  assert.ok(result.durationMs < 750)
})

test('stdio-drain cleanup waits for SIGKILL when a leaked descendant ignores SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-process-drain-kill-'))
  const marker = join(root, 'sigterm-immune-descendant.txt')
  const grandchild = [
    'process.on("SIGTERM", () => {})',
    'setTimeout(() => require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "alive"), 700)',
    'setInterval(() => {}, 1000)'
  ].join(';')
  const parent = [
    'const { spawn } = require("node:child_process")',
    'const child = spawn(process.execPath, ["-e", ' + JSON.stringify(grandchild) + '], { stdio: ["ignore", "inherit", "inherit"] })',
    'child.unref()'
  ].join(';')

  const result = await runProcess({
    program: process.execPath,
    args: ['-e', parent],
    cwd: root,
    timeoutMs: 2000,
    stdioDrainTimeoutMs: 50,
    stdioTerminateGraceMs: 100,
    stdioKillWaitMs: 100,
    env: buildSafeEnvironment(process.env)
  })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 750))

  assert.equal(result.stdioDrainTimedOut, true)
  assert.ok(result.durationMs >= 100)
  await assert.rejects(readFile(marker, 'utf8'), (error) => error.code === 'ENOENT')
})
