import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseImplementationConfig, resolveImplementationExecutable } from '../src/config/implementation.mjs'

const valid = {
  schemaVersion: 1,
  adapter: {
    id: 'team-agent',
    command: ['./tools/implement', '--mode', 'bounded'],
    network: false,
    timeoutMs: 120000
  },
  writePolicy: {
    allowedPrefixes: ['src/', 'build.gradle.kts'],
    maxChangedFiles: 20,
    maxDiffBytes: 1048576
  },
  recovery: { maxAttempts: 2 }
}

test('implementation config is disabled by default and normalizes a strict enabled contract', () => {
  assert.deepEqual(parseImplementationConfig('{"schemaVersion":1,"adapter":null}'), {
    schemaVersion: 1,
    adapter: null,
    recovery: { maxAttempts: 2 }
  })
  const parsed = parseImplementationConfig(JSON.stringify(valid), 'implementation.json')
  assert.equal(parsed.adapter.command[0], './tools/implement')
  assert.deepEqual(parsed.writePolicy.allowedPrefixes, ['src/', 'build.gradle.kts'])
  assert.equal(parsed.recovery.maxAttempts, 2)
})

test('implementation config rejects unknown authority, traversal, missing budgets, and excessive recovery', () => {
  const unknown = structuredClone(valid)
  unknown.adapter.deploy = true
  assert.throws(() => parseImplementationConfig(JSON.stringify(unknown)), /unknown key: deploy/)

  const traversal = structuredClone(valid)
  traversal.adapter.command[0] = '../outside'
  assert.throws(() => parseImplementationConfig(JSON.stringify(traversal)), /stay inside the project/)

  const missingBudget = structuredClone(valid)
  delete missingBudget.writePolicy
  assert.throws(() => parseImplementationConfig(JSON.stringify(missingBudget)), /writePolicy must be an object/)

  const retries = structuredClone(valid)
  retries.recovery.maxAttempts = 6
  assert.throws(() => parseImplementationConfig(JSON.stringify(retries)), /between 1 and 5/)
})

test('implementation executable resolver accepts only a project-owned regular executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-implementation-config-'))
  await mkdir(join(root, 'tools'), { recursive: true })
  await writeFile(join(root, 'tools/real'), '#!/bin/sh\nexit 0\n', 'utf8')
  await chmod(join(root, 'tools/real'), 0o755)
  const resolved = await resolveImplementationExecutable(root, ['./tools/real'])
  assert.equal(resolved.displayPath, './tools/real')

  await symlink(join(root, 'tools/real'), join(root, 'tools/link'))
  await assert.rejects(resolveImplementationExecutable(root, ['./tools/link']), /symbolic link/)
})
