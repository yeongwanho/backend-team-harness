import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const cli = resolve('src/cli.mjs')

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    ...options
  })
}

test('CLI help exposes the actual task and verification commands', () => {
  const result = runCli(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /bth task create/)
  assert.match(result.stdout, /bth verify/)
})

test('CLI refuses implicit force overwrite in the current directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-force-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')

  const result = runCli(['init', '--force'], {
    cwd: root,
    encoding: 'utf8'
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /requires an explicit project path/)
})

test('CLI drives one approved task through real guarded verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-cli-flow-'))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  await writeFile(join(root, 'gradlew'), '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(join(root, 'gradlew'), 0o755)

  const commands = [
    ['init', root],
    ['task', 'create', 'CLI-1', root, '--context', 'Synthetic requirement'],
    ['task', 'advance', 'CLI-1', 'CONTEXT_READY', root, '--by', 'developer'],
    ['task', 'plan', 'CLI-1', root, '--text', 'Run the fixed test wrapper.', '--by', 'developer'],
    ['task', 'advance', 'CLI-1', 'PLAN_PROPOSED', root, '--by', 'developer'],
    ['task', 'advance', 'CLI-1', 'PLAN_APPROVED', root, '--by', 'reviewer', '--approve'],
    ['task', 'advance', 'CLI-1', 'IMPLEMENTING', root, '--by', 'developer'],
    ['verify', 'CLI-1', root]
  ]

  for (const command of commands) {
    const result = runCli(command)
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }

  const status = runCli(['task', 'status', 'CLI-1', root, '--json'])
  assert.equal(status.status, 0, status.stderr)
  assert.equal(JSON.parse(status.stdout).record.state, 'VERIFIED')

  const done = runCli(['task', 'advance', 'CLI-1', 'DONE', root, '--by', 'developer'])
  assert.equal(done.status, 0, done.stderr)
})
