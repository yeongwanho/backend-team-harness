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
    MAVEN_OPTS: '-javaagent:/tmp/untrusted.jar',
    AWS_SECRET_ACCESS_KEY: 'must-not-pass',
    DATABASE_URL: 'must-not-pass'
  })

  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.HOME, '/tmp/example-home')
  assert.equal(environment.CI, 'true')
  assert.equal(environment.BTH_NODE, process.execPath)
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(environment.DATABASE_URL, undefined)
  assert.equal(environment.MAVEN_OPTS, undefined)
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
