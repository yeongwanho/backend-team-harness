import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'

test('child-process environment excludes unrelated credentials', () => {
  const environment = buildSafeEnvironment({
    PATH: '/usr/bin',
    HOME: '/tmp/example-home',
    AWS_SECRET_ACCESS_KEY: 'must-not-pass',
    DATABASE_URL: 'must-not-pass'
  })

  assert.equal(environment.PATH, '/usr/bin')
  assert.equal(environment.HOME, '/tmp/example-home')
  assert.equal(environment.CI, 'true')
  assert.equal(environment.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(environment.DATABASE_URL, undefined)
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
