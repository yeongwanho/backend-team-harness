import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
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

test('declared ignored build inputs are source-bound by content hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-source-explicit-'))
  await writeFile(join(root, '.gitignore'), 'gradle.properties\n', 'utf8')
  await writeFile(join(root, 'service.txt'), 'service\n', 'utf8')
  await writeFile(join(root, 'gradle.properties'), 'featureFlag=one\n', 'utf8')
  initializeGit(root)

  const first = await captureSourceBinding(root, { explicitPaths: ['gradle.properties'] })
  await writeFile(join(root, 'gradle.properties'), 'featureFlag=two\n', 'utf8')
  const second = await captureSourceBinding(root, { explicitPaths: ['gradle.properties'] })

  assert.equal(first.clean, true)
  assert.equal(first.explicitInputs.length, 1)
  assert.notEqual(second.fingerprint, first.fingerprint)
})

test('declared inputs cannot escape content binding through a symlink', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-source-symlink-'))
  await writeFile(join(root, 'service.txt'), 'service\n', 'utf8')
  await writeFile(join(root, 'real.properties'), 'featureFlag=one\n', 'utf8')
  await symlink('real.properties', join(root, 'linked.properties'))
  initializeGit(root)

  await assert.rejects(
    captureSourceBinding(root, { explicitPaths: ['linked.properties'] }),
    /cannot use a symbolic link/
  )
})

test('an allowed command symlink is bound without following an intermediate link outside', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-source-command-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'bth-source-command-outside-'))
  await mkdir(join(outside, 'bin'))
  await writeFile(join(outside, 'bin/verify'), 'outside command\n', 'utf8')
  await symlink(outside, join(root, 'linked-tools'))
  await writeFile(join(root, 'service.txt'), 'service\n', 'utf8')
  initializeGit(root)

  const binding = await captureSourceBinding(root, {
    explicitPaths: ['linked-tools/bin/verify'],
    allowSymlinkPaths: ['linked-tools/bin/verify']
  })

  assert.equal(binding.explicitInputs[0].kind, 'symlink')
  assert.match(binding.explicitInputs[0].contentSha256, /^[a-f0-9]{64}$/)
})
