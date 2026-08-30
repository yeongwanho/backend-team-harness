import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { runImplementationProvider, selectImplementationProfile } from '../src/providers/model-cli.mjs'
import { buildSafeEnvironment, runProcess } from '../src/core/process-runner.mjs'

test('real Windows command shim executes provider JSON and normalizes telemetry', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-win-provider-'))
  const shim = join(root, 'codex.cmd')
  await writeFile(shim, '@echo off\r\n"' + process.execPath + '" -e "console.log(JSON.stringify({usage:{input_tokens:11,output_tokens:3}}))"\r\n')
  await chmod(shim, 0o755).catch(() => {})
  const env = buildSafeEnvironment({ ...process.env, PATH: root + delimiter + process.env.PATH, PATHEXT: '.CMD;.EXE;.BAT' })
  const result = await runImplementationProvider(
    { provider: 'codex', model: null, timeoutMs: 10_000 },
    { requestPath: './request.json', cwd: root, profile: selectImplementationProfile({ mode: 'fast' }), env },
    { env, version: 'windows-fixture' }
  )
  assert.equal(result.process.exitCode, 0)
  assert.equal(result.metadata.usage.tokens.input, 11)
  assert.equal(result.metadata.usage.tokens.output, 3)
})

test('real Windows timeout terminates the provider descendant tree', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-win-tree-'))
  const pidFile = join(root, 'child.pid')
  const script = join(root, 'parent.mjs')
  await writeFile(script, [
    "import { spawn } from 'node:child_process'",
    "import { writeFileSync } from 'node:fs'",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
    'writeFileSync(' + JSON.stringify(pidFile) + ', String(child.pid))',
    'setInterval(() => {}, 1000)'
  ].join('\n'))
  const result = await runProcess({
    program: process.execPath,
    args: [script],
    cwd: root,
    timeoutMs: 500,
    env: buildSafeEnvironment()
  })
  assert.equal(result.timedOut, true)
  const childPid = Number(await readFile(pidFile, 'utf8'))
  const deadline = Date.now() + 5000
  let alive = true
  while (alive && Date.now() < deadline) {
    try { process.kill(childPid, 0) } catch { alive = false }
    if (alive) await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.equal(alive, false, 'taskkill /t must terminate the descendant process')
})
