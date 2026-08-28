import test from 'node:test'
import assert from 'node:assert/strict'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { initProject } from '../src/init-project.mjs'

async function backendProject(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, 'build.gradle.kts'), 'plugins { java }\n', 'utf8')
  return root
}

test('init creates the shared contract', async () => {
  const root = await backendProject('bth-init-')
  const result = await initProject(root)

  assert.ok(result.created.includes('.backend-harness/project.md'))
  assert.match(
    await readFile(join(root, '.backend-harness/project.md'), 'utf8'),
    /# Project/
  )
})

test('init preserves an existing team document by default', async () => {
  const root = await backendProject('bth-preserve-')
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Team-owned content\n', 'utf8')

  const result = await initProject(root)

  assert.ok(result.skipped.includes('.backend-harness/project.md'))
  assert.equal(await readFile(projectFile, 'utf8'), '# Team-owned content\n')
})

test('force backs up every replaced team document before overwriting', async () => {
  const root = await backendProject('bth-force-')
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Preserve this exact content\n', 'utf8')

  const result = await initProject(root, {
    force: true,
    now: () => new Date('2026-08-29T01:02:03.000Z')
  })

  const projectBackup = result.backups.find((path) => path.endsWith('/project.md'))
  assert.ok(projectBackup)
  assert.equal(await readFile(join(root, projectBackup), 'utf8'), '# Preserve this exact content\n')
  assert.match(await readFile(projectFile, 'utf8'), /# Project/)
  assert.ok(result.updated.includes('.backend-harness/project.md'))
})

test('init rejects a symlinked harness directory and writes nothing outside the project', async () => {
  const root = await backendProject('bth-symlink-root-')
  const outside = await mkdtemp(join(tmpdir(), 'bth-symlink-outside-'))
  await symlink(outside, join(root, '.backend-harness'))

  await assert.rejects(initProject(root), /symbolic link/)
  assert.deepEqual(await readdir(outside), [])
})

test('init refuses missing roots and does not create them', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'bth-missing-parent-'))
  const root = join(parent, 'not-created')

  await assert.rejects(initProject(root), /must already exist/)
  assert.deepEqual(await readdir(parent), [])
})

test('init refuses the user home directory even when force is requested', async () => {
  await assert.rejects(initProject(homedir(), { force: true, allowUnversioned: true }), /home directory/)
})

test('an intentional empty directory requires allowUnversioned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-unversioned-'))

  await assert.rejects(initProject(root), /neither inside a Git worktree nor a recognizable/)
  const result = await initProject(root, { allowUnversioned: true })
  assert.ok(result.created.length > 0)
})
