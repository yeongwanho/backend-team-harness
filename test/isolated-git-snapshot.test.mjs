import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeGit, runGit } from '../test-support/git-project.mjs'
import { createIsolatedGitSnapshot } from '../src/evaluation/isolated-git-snapshot.mjs'

test('depth-one local snapshots preserve the exact SHA/tree without history, shared objects or dirty edits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bth-snapshot-history-')), root = join(directory, 'source')
  await mkdir(root)
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(root, 'old.bin'), randomBytes(256 * 1024))
  initializeGit(root)
  const ancestor = runGit(root, ['rev-parse', 'HEAD'])
  const oldBlob = runGit(root, ['rev-parse', 'HEAD:old.bin'])
  runGit(root, ['rm', '-q', 'old.bin'])
  await writeFile(join(root, 'current.txt'), 'committed\n')
  runGit(root, ['add', '.']); runGit(root, ['commit', '-qm', 'current'])
  const sha = runGit(root, ['rev-parse', 'HEAD'])
  await writeFile(join(root, 'current.txt'), 'uncommitted\n')
  await writeFile(join(root, 'private-untracked.txt'), 'preserved\n')
  const destination = join(directory, 'snapshot')
  await createIsolatedGitSnapshot(root, sha, destination)
  assert.equal(runGit(destination, ['rev-parse', 'HEAD']), sha)
  assert.equal(runGit(destination, ['rev-list', '--count', 'HEAD']), '1')
  assert.equal(runGit(destination, ['remote']), '')
  assert.equal(await readFile(join(destination, 'current.txt'), 'utf8'), 'committed\n')
  assert.equal(await readFile(join(root, 'current.txt'), 'utf8'), 'uncommitted\n')
  await assert.rejects(readFile(join(destination, 'private-untracked.txt')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(destination, '.git/objects/info/alternates')), { code: 'ENOENT' })
  assert.throws(() => runGit(destination, ['cat-file', '-e', ancestor]))
  assert.throws(() => runGit(destination, ['cat-file', '-e', oldBlob]))
})

test('snapshots reject nonlocal input, nonpinned revisions and populated destination', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bth-snapshot-boundary-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'keep'), 'keep'); initializeGit(root)
  const sha = runGit(root, ['rev-parse', 'HEAD'])
  await assert.rejects(createIsolatedGitSnapshot('https://example.invalid/repo.git', sha, join(root, 'out')))
  await assert.rejects(createIsolatedGitSnapshot(root, 'HEAD', join(root, 'out')))
  await assert.rejects(createIsolatedGitSnapshot(root, sha, root))
  await assert.rejects(createIsolatedGitSnapshot(root, sha, join(root, '..still-inside')))
  assert.equal(await readFile(join(root, 'keep'), 'utf8'), 'keep')
})

test('snapshots reject Git symlink and submodule entries before creating any output', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bth-snapshot-links-')), root = join(directory, 'source')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(root); await writeFile(join(root, 'content'), '../outside'); initializeGit(root)
  const original = runGit(root, ['rev-parse', 'HEAD']), blob = runGit(root, ['rev-parse', 'HEAD:content'])
  for (const [mode, object, name] of [['120000', blob, 'link'], ['160000', original, 'submodule']]) {
    runGit(root, ['update-index', '--add', '--cacheinfo', mode + ',' + object + ',' + name])
    runGit(root, ['commit', '-qm', 'unsafe entry'])
    const sha = runGit(root, ['rev-parse', 'HEAD']), destination = join(directory, name)
    await assert.rejects(createIsolatedGitSnapshot(root, sha, destination), /symlinks, submodules/)
    await assert.rejects(readFile(join(destination, '.git/HEAD')), { code: 'ENOENT' })
    runGit(root, ['update-index', '--force-remove', name])
  }
})
