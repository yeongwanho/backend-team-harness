import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureSourceBinding } from '../src/core/source-binding.mjs'
import { initializeGit } from '../test-support/git-project.mjs'

test('source binding is stable for harness runtime files and changes with source content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-source-binding-'))
  const source = join(root, 'service.txt')
  await writeFile(source, 'version one\n', 'utf8')
  initializeGit(root)
  const original = await captureSourceBinding(root)

  await mkdir(join(root, '.backend-harness/tasks/T-1'), { recursive: true })
  await writeFile(join(root, '.backend-harness/tasks/T-1/task.json'), '{}\n', 'utf8')
  const runtimeOnly = await captureSourceBinding(root)
  assert.equal(runtimeOnly.fingerprint, original.fingerprint)

  await writeFile(source, 'version two\n', 'utf8')
  const changed = await captureSourceBinding(root)
  assert.notEqual(changed.fingerprint, original.fingerprint)

  await writeFile(source, 'version one\n', 'utf8')
  const restored = await captureSourceBinding(root)
  assert.equal(restored.fingerprint, original.fingerprint)

  await writeFile(join(root, 'untracked.txt'), 'first\n', 'utf8')
  const untrackedOne = await captureSourceBinding(root)
  await writeFile(join(root, 'untracked.txt'), 'second\n', 'utf8')
  const untrackedTwo = await captureSourceBinding(root)
  assert.notEqual(untrackedOne.fingerprint, untrackedTwo.fingerprint)
})

test('source binding supports a backend project inside a larger Git worktree', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'bth-source-monorepo-'))
  const service = join(repository, 'services/orders')
  await mkdir(service, { recursive: true })
  await writeFile(join(repository, 'README.md'), '# monorepo\n', 'utf8')
  await writeFile(join(service, 'service.txt'), 'orders\n', 'utf8')
  initializeGit(repository)

  const first = await captureSourceBinding(service)
  await mkdir(join(service, '.backend-harness/tasks/T-1'), { recursive: true })
  await writeFile(join(service, '.backend-harness/tasks/T-1/task.json'), '{}\n', 'utf8')
  const second = await captureSourceBinding(service)

  assert.equal(first.projectPath, 'services/orders')
  assert.equal(second.fingerprint, first.fingerprint)
})
