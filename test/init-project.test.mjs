import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initProject } from '../src/init-project.mjs'

test('init creates the shared contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-init-'))
  const result = await initProject(root)

  assert.ok(result.created.includes('.backend-harness/project.md'))
  assert.match(
    await readFile(join(root, '.backend-harness/project.md'), 'utf8'),
    /# Project/
  )
})

test('init preserves an existing team document by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-preserve-'))
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Team-owned content\n', 'utf8')

  const result = await initProject(root)

  assert.ok(result.skipped.includes('.backend-harness/project.md'))
  assert.equal(await readFile(projectFile, 'utf8'), '# Team-owned content\n')
})

test('force replaces an existing generated contract explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bth-force-'))
  await initProject(root)
  const projectFile = join(root, '.backend-harness/project.md')
  await writeFile(projectFile, '# Replace me\n', 'utf8')

  await initProject(root, { force: true })

  assert.match(await readFile(projectFile, 'utf8'), /# Project/)
})

